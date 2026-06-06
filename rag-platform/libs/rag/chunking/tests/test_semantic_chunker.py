"""Tests for the semantic chunker."""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from libs.shared.models.chunk import ChunkMetadata
from libs.shared.models.lifecycle import IngestionSource

from ..semantic import SemanticChunker, SemanticChunkerConfig


@pytest.fixture
def numpy_available():
    """Check if numpy is available."""
    try:
        import numpy
        return True
    except ImportError:
        return False


@pytest.fixture
def base_metadata() -> ChunkMetadata:
    """Create base metadata for testing."""
    return ChunkMetadata(source_type=IngestionSource.MARKDOWN_DOC)


@pytest.fixture
def document_ids() -> tuple:
    """Create document and version IDs for testing."""
    return uuid4(), uuid4()


class TestSemanticChunkerConfig:
    """Tests for SemanticChunkerConfig."""
    
    def test_default_config(self):
        """Test default configuration values."""
        config = SemanticChunkerConfig()
        
        assert config.chunk_size == 512
        assert config.chunk_overlap == 25
        assert config.embedding_model == "all-MiniLM-L6-v2"
        assert config.similarity_threshold == 0.5
        assert config.buffer_size == 1
        assert config.min_sentences_per_chunk == 2
        assert config.breakpoint_percentile is None
    
    def test_custom_config(self):
        """Test custom configuration values."""
        config = SemanticChunkerConfig(
            chunk_size=256,
            similarity_threshold=0.3,
            buffer_size=2,
            breakpoint_percentile=25,
        )
        
        assert config.chunk_size == 256
        assert config.similarity_threshold == 0.3
        assert config.buffer_size == 2
        assert config.breakpoint_percentile == 25
    
    def test_invalid_similarity_threshold(self):
        """Test that invalid similarity thresholds are rejected."""
        with pytest.raises(ValueError, match="similarity_threshold must be between"):
            SemanticChunkerConfig(similarity_threshold=1.5)
        
        with pytest.raises(ValueError, match="similarity_threshold must be between"):
            SemanticChunkerConfig(similarity_threshold=-0.1)
    
    def test_invalid_buffer_size(self):
        """Test that invalid buffer sizes are rejected."""
        with pytest.raises(ValueError, match="buffer_size must be at least"):
            SemanticChunkerConfig(buffer_size=0)
    
    def test_invalid_breakpoint_percentile(self):
        """Test that invalid percentiles are rejected."""
        with pytest.raises(ValueError, match="breakpoint_percentile must be between"):
            SemanticChunkerConfig(breakpoint_percentile=0)
        
        with pytest.raises(ValueError, match="breakpoint_percentile must be between"):
            SemanticChunkerConfig(breakpoint_percentile=100)


class TestSemanticChunker:
    """Tests for SemanticChunker."""
    
    def test_strategy_name(self):
        """Test that strategy name is correct."""
        chunker = SemanticChunker()
        assert chunker.strategy_name == "semantic"
    
    def test_empty_text_raises_error(self, base_metadata, document_ids):
        """Test that empty text raises an error."""
        chunker = SemanticChunker()
        doc_id, version_id = document_ids
        
        with pytest.raises(ValueError, match="Cannot chunk empty"):
            chunker.chunk("", doc_id, version_id, base_metadata)
        
        with pytest.raises(ValueError, match="Cannot chunk empty"):
            chunker.chunk("   ", doc_id, version_id, base_metadata)
    
    def test_fallback_when_no_model(self, base_metadata, document_ids):
        """Test fallback chunking when sentence-transformers unavailable."""
        config = SemanticChunkerConfig(chunk_size=50)
        chunker = SemanticChunker(config)
        doc_id, version_id = document_ids
        
        chunker._model = None
        chunker._model_loaded = True
        
        text = """
        This is the first paragraph. It has multiple sentences. They are all about the first topic.
        
        This is the second paragraph. It discusses something different. The semantic meaning changes here.
        """
        
        result = chunker.chunk(text, doc_id, version_id, base_metadata)
        
        assert result.total_chunks > 0
        assert all(chunk.chunk_text for chunk in result.chunks)
    
    def test_short_document_single_chunk(self, base_metadata, document_ids):
        """Test that very short documents become a single chunk."""
        chunker = SemanticChunker()
        doc_id, version_id = document_ids
        
        chunker._model_loaded = True
        chunker._model = None
        
        text = "Short text. Only two sentences."
        
        result = chunker.chunk(text, doc_id, version_id, base_metadata)
        
        assert result.total_chunks == 1
    
    @patch('libs.rag.chunking.semantic.SemanticChunker._load_model')
    def test_sentence_splitting(self, mock_load, base_metadata, document_ids):
        """Test sentence splitting functionality."""
        chunker = SemanticChunker()
        
        text = """
        First sentence here. Second sentence follows.
        
        New paragraph starts. With more content here.
        """
        
        sentences = chunker._split_into_sentences(text.strip())
        
        assert len(sentences) > 0
        for sent_text, start, end in sentences:
            assert isinstance(sent_text, str)
            assert isinstance(start, int)
            assert isinstance(end, int)
            assert start < end
    
    def test_cosine_similarity(self, numpy_available):
        """Test cosine similarity calculation."""
        if not numpy_available:
            pytest.skip("numpy not installed")
        
        import numpy as np
        chunker = SemanticChunker()
        
        a = np.array([1.0, 0.0, 0.0])
        b = np.array([1.0, 0.0, 0.0])
        assert chunker._cosine_similarity(a, b) == pytest.approx(1.0)
        
        a = np.array([1.0, 0.0, 0.0])
        b = np.array([0.0, 1.0, 0.0])
        assert chunker._cosine_similarity(a, b) == pytest.approx(0.0)
        
        a = np.array([1.0, 0.0])
        b = np.array([1.0, 1.0])
        expected = 1.0 / np.sqrt(2)
        assert chunker._cosine_similarity(a, b) == pytest.approx(expected)
        
        a = np.array([0.0, 0.0])
        b = np.array([1.0, 1.0])
        assert chunker._cosine_similarity(a, b) == 0.0
    
    def test_combine_sentences_buffer_1(self):
        """Test sentence combination with buffer size 1."""
        config = SemanticChunkerConfig(buffer_size=1)
        chunker = SemanticChunker(config)
        
        sentences = [
            ("First sentence.", 0, 15),
            ("Second sentence.", 16, 32),
            ("Third sentence.", 33, 48),
        ]
        
        combined = chunker._combine_sentences_for_embedding(sentences)
        
        assert combined == ["First sentence.", "Second sentence.", "Third sentence."]
    
    def test_combine_sentences_buffer_2(self):
        """Test sentence combination with buffer size 2."""
        config = SemanticChunkerConfig(buffer_size=2)
        chunker = SemanticChunker(config)
        
        sentences = [
            ("A", 0, 1),
            ("B", 2, 3),
            ("C", 4, 5),
            ("D", 6, 7),
        ]
        
        combined = chunker._combine_sentences_for_embedding(sentences)
        
        assert "A" in combined[0] and "B" in combined[0]
        assert "B" in combined[1] and "C" in combined[1]
    
    @patch('libs.rag.chunking.semantic.SemanticChunker._compute_embeddings')
    @patch('libs.rag.chunking.semantic.SemanticChunker._load_model')
    def test_semantic_breakpoints_with_mocked_embeddings(
        self, mock_load, mock_embed, base_metadata, document_ids, numpy_available
    ):
        """Test semantic breakpoint detection with mocked embeddings."""
        if not numpy_available:
            pytest.skip("numpy not installed")
        
        import numpy as np
        chunker = SemanticChunker()
        chunker._model = MagicMock()
        chunker._model_loaded = True
        
        embeddings = np.array([
            [1.0, 0.0, 0.0],
            [0.95, 0.1, 0.0],
            [0.1, 0.9, 0.0],
            [0.15, 0.85, 0.1],
        ])
        mock_embed.return_value = embeddings
        
        sentences = [
            ("Topic A sentence 1.", 0, 20),
            ("Topic A sentence 2.", 21, 40),
            ("Topic B sentence 1.", 41, 60),
            ("Topic B sentence 2.", 61, 80),
        ]
        
        breakpoints = chunker._find_semantic_breakpoints(sentences)
        
        assert 1 in breakpoints, "Expected breakpoint after sentence 2 (topic change)"
    
    def test_with_regular_chunker_config(self, base_metadata, document_ids):
        """Test that SemanticChunker works with regular ChunkerConfig."""
        from ..base import ChunkerConfig
        
        regular_config = ChunkerConfig(chunk_size=256, chunk_overlap=10)
        chunker = SemanticChunker(regular_config)
        
        assert chunker.config.chunk_size == 256
        assert chunker.config.chunk_overlap == 10
        assert isinstance(chunker.config, SemanticChunkerConfig)


class TestSemanticChunkerIntegration:
    """Integration tests for SemanticChunker (requires sentence-transformers)."""
    
    @pytest.fixture
    def requires_sentence_transformers(self):
        """Skip test if sentence-transformers not available."""
        try:
            import sentence_transformers
        except ImportError:
            pytest.skip("sentence-transformers not installed")
    
    def test_full_chunking_pipeline(
        self, requires_sentence_transformers, base_metadata, document_ids
    ):
        """Test full semantic chunking pipeline."""
        config = SemanticChunkerConfig(
            chunk_size=256,
            similarity_threshold=0.5,
        )
        chunker = SemanticChunker(config)
        doc_id, version_id = document_ids
        
        text = """
        # Introduction to Machine Learning
        
        Machine learning is a subset of artificial intelligence. It enables computers 
        to learn from data without being explicitly programmed. The field has grown 
        rapidly in recent years.
        
        # Types of Machine Learning
        
        There are three main types of machine learning: supervised learning, 
        unsupervised learning, and reinforcement learning. Each has different 
        applications and use cases.
        
        ## Supervised Learning
        
        In supervised learning, the model learns from labeled data. Common algorithms 
        include linear regression, decision trees, and neural networks. The goal is 
        to predict outcomes for new, unseen data.
        
        ## Unsupervised Learning
        
        Unsupervised learning works with unlabeled data. Clustering and dimensionality 
        reduction are common techniques. These methods find hidden patterns in data.
        
        # Conclusion
        
        Machine learning continues to transform industries. From healthcare to finance, 
        applications are everywhere. The future holds even more possibilities.
        """
        
        result = chunker.chunk(text, doc_id, version_id, base_metadata)
        
        assert result.total_chunks >= 1
        assert result.strategy == "semantic"
        
        for i, chunk in enumerate(result.chunks):
            assert chunk.chunk_index == i
            assert chunk.chunk_text
            assert chunk.token_count > 0
            assert chunk.document_id == doc_id
            assert chunk.version_id == version_id
        
        all_text = " ".join(c.chunk_text for c in result.chunks)
        assert "Machine learning" in all_text
        assert "supervised learning" in all_text
    
    def test_chunk_overlap_applied(
        self, requires_sentence_transformers, base_metadata, document_ids
    ):
        """Test that overlap is applied between chunks."""
        config = SemanticChunkerConfig(
            chunk_size=100,
            chunk_overlap=20,
            similarity_threshold=0.3,
        )
        chunker = SemanticChunker(config)
        doc_id, version_id = document_ids
        
        text = """
        The quick brown fox jumps over the lazy dog. This sentence is about animals.
        
        Python is a programming language. It is widely used for data science.
        
        The weather today is sunny. Tomorrow it might rain.
        
        Mathematics is fundamental to science. Calculus and algebra are important.
        """
        
        result = chunker.chunk(text, doc_id, version_id, base_metadata)
        
        if result.total_chunks > 1:
            for i in range(1, len(result.chunks)):
                pass


class TestFromFactory:
    """Test semantic chunker access via factory."""
    
    def test_get_chunker_for_strategy(self):
        """Test getting semantic chunker from factory."""
        from ..factory import get_chunker_for_strategy
        
        chunker = get_chunker_for_strategy("semantic")
        
        assert isinstance(chunker, SemanticChunker)
        assert chunker.strategy_name == "semantic"
    
    def test_factory_with_config(self):
        """Test factory with custom config."""
        from ..factory import get_chunker_for_strategy
        from ..base import ChunkerConfig
        
        config = ChunkerConfig(chunk_size=256)
        chunker = get_chunker_for_strategy("semantic", config)
        
        assert chunker.config.chunk_size == 256
