"""Semantic chunker implementation using embedding-based boundary detection.

This chunker uses sentence embeddings to identify natural semantic boundaries
in text. Instead of splitting at fixed character intervals, it:

1. Splits text into sentences
2. Computes embeddings for each sentence
3. Identifies semantic breakpoints where consecutive sentences have
   low similarity (semantic shift)
4. Groups sentences into chunks at these natural boundaries

Research shows semantic chunking typically yields 5-15% improvement in
RAG retrieval quality compared to fixed-size chunking.

Requires: sentence-transformers library
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, List, Optional, Tuple
from uuid import UUID

from libs.shared.models.chunk import Chunk, ChunkMetadata, ChunkingResult

from .base import BaseChunker, ChunkerConfig
from .utils import (
    TextSpan,
    create_overlap_text,
    estimate_token_count,
    merge_small_spans,
    normalize_whitespace,
)

if TYPE_CHECKING:
    import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class SemanticChunkerConfig(ChunkerConfig):
    """Configuration for semantic chunking.
    
    Extends ChunkerConfig with embedding-specific settings.
    
    Attributes:
        embedding_model: Sentence transformer model name for embeddings.
        similarity_threshold: Cosine similarity below this indicates a semantic boundary.
            Lower values = more aggressive splitting, higher = fewer chunks.
        buffer_size: Number of sentences to combine when computing similarity.
            Higher values smooth out noise but may miss fine boundaries.
        min_sentences_per_chunk: Minimum sentences before allowing a split.
        breakpoint_percentile: Alternative to threshold - split at the N-th percentile
            of lowest similarities. Set to None to use threshold instead.
    """
    embedding_model: str = "all-MiniLM-L6-v2"
    similarity_threshold: float = 0.5
    buffer_size: int = 1
    min_sentences_per_chunk: int = 2
    breakpoint_percentile: Optional[int] = None
    
    def __post_init__(self) -> None:
        super().__post_init__()
        if self.similarity_threshold < 0 or self.similarity_threshold > 1:
            raise ValueError("similarity_threshold must be between 0 and 1")
        if self.buffer_size < 1:
            raise ValueError("buffer_size must be at least 1")
        if self.breakpoint_percentile is not None:
            if self.breakpoint_percentile < 1 or self.breakpoint_percentile > 99:
                raise ValueError("breakpoint_percentile must be between 1 and 99")


class SemanticChunker(BaseChunker):
    """Semantic chunker that splits at natural topic boundaries.
    
    Uses sentence embeddings to detect where the semantic content
    shifts, creating chunks that are more coherent and self-contained
    than fixed-size alternatives.
    
    Algorithm:
    1. Split document into sentences
    2. Compute embeddings for sentence groups (buffered)
    3. Calculate cosine similarity between consecutive groups
    4. Identify breakpoints where similarity drops below threshold
    5. Merge sentences between breakpoints into chunks
    6. Apply min/max size constraints and overlap
    
    Benefits over recursive chunking:
    - Chunks contain semantically related content
    - Better retrieval accuracy (5-15% typical improvement)
    - Fewer chunks that split mid-concept
    
    Trade-offs:
    - Slower due to embedding computation
    - Requires sentence-transformers dependency
    - Less predictable chunk sizes
    """
    
    def __init__(self, config: Optional[SemanticChunkerConfig] = None) -> None:
        """Initialize semantic chunker with configuration.
        
        Args:
            config: Semantic chunking configuration. Uses defaults if not provided.
        """
        if config is None:
            config = SemanticChunkerConfig()
        elif not isinstance(config, SemanticChunkerConfig):
            config = SemanticChunkerConfig(
                chunk_size=config.chunk_size,
                chunk_overlap=config.chunk_overlap,
                min_chunk_size=config.min_chunk_size,
                max_chunk_size=config.max_chunk_size,
                preserve_code_blocks=config.preserve_code_blocks,
                preserve_lists=config.preserve_lists,
                include_section_headers=config.include_section_headers,
            )
        
        super().__init__(config)
        self._model = None
        self._model_loaded = False
    
    @property
    def semantic_config(self) -> SemanticChunkerConfig:
        """Get config cast to SemanticChunkerConfig."""
        return self.config
    
    @property
    def strategy_name(self) -> str:
        return "semantic"
    
    def _load_model(self) -> None:
        """Lazy load the sentence transformer model and numpy."""
        if self._model_loaded:
            return
        
        try:
            global np
            import numpy as np
            from sentence_transformers import SentenceTransformer
            
            self._model = SentenceTransformer(self.semantic_config.embedding_model)
            self._model_loaded = True
            logger.info(f"Loaded embedding model: {self.semantic_config.embedding_model}")
        except ImportError as e:
            logger.warning(
                f"Dependencies not installed: {e}. "
                "Install with: pip install numpy sentence-transformers"
            )
            self._model = None
            self._model_loaded = True
    
    def chunk(
        self,
        text: str,
        document_id: UUID,
        version_id: UUID,
        base_metadata: ChunkMetadata,
    ) -> ChunkingResult:
        """Split text into semantically coherent chunks.
        
        Args:
            text: Full document text.
            document_id: Parent document UUID.
            version_id: Document version UUID.
            base_metadata: Metadata to attach to all chunks.
        
        Returns:
            ChunkingResult with semantically-split chunks.
        """
        self._validate_input(text)
        self._load_model()
        
        normalized = normalize_whitespace(text)
        
        if self._model is None:
            logger.warning("Falling back to sentence-based splitting without embeddings")
            return self._fallback_chunk(normalized, document_id, version_id, base_metadata)
        
        sentences = self._split_into_sentences(normalized)
        
        if len(sentences) < 3:
            return self._create_single_chunk(
                normalized, document_id, version_id, base_metadata
            )
        
        breakpoints = self._find_semantic_breakpoints(sentences)
        
        spans = self._create_spans_from_breakpoints(sentences, breakpoints, normalized)
        
        merged_spans = merge_small_spans(
            spans=spans,
            min_tokens=self.config.min_chunk_size,
            max_tokens=self.config.max_chunk_size,
        )
        
        chunks = self._create_chunks_with_overlap(
            spans=merged_spans,
            document_id=document_id,
            version_id=version_id,
            base_metadata=base_metadata,
        )
        
        return self._create_result(document_id, version_id, chunks)
    
    def _split_into_sentences(self, text: str) -> List[Tuple[str, int, int]]:
        """Split text into sentences with position tracking.
        
        Uses multiple sentence boundary patterns to handle various formats
        including technical documentation with code snippets.
        
        Args:
            text: Normalized text to split.
        
        Returns:
            List of (sentence_text, start_pos, end_pos) tuples.
        """
        sentence_pattern = re.compile(
            r'(?<=[.!?])\s+(?=[A-Z])|'
            r'(?<=\n)\s*(?=\n)|'
            r'(?<=```)\s*\n|'
            r'\n(?=#{1,6}\s)|'
            r'\n(?=[-*]\s)|'
            r'\n(?=\d+\.\s)'
        )
        
        sentences = []
        last_end = 0
        
        for match in sentence_pattern.finditer(text):
            start = match.start()
            if start > last_end:
                sentence = text[last_end:start].strip()
                if sentence:
                    sentences.append((sentence, last_end, start))
            last_end = match.end()
        
        if last_end < len(text):
            sentence = text[last_end:].strip()
            if sentence:
                sentences.append((sentence, last_end, len(text)))
        
        if not sentences:
            chunks = text.split('\n\n')
            pos = 0
            for chunk in chunks:
                chunk = chunk.strip()
                if chunk:
                    start = text.find(chunk, pos)
                    sentences.append((chunk, start, start + len(chunk)))
                    pos = start + len(chunk)
        
        return sentences
    
    def _compute_embeddings(self, texts: List[str]) -> "np.ndarray":
        """Compute embeddings for a list of texts.
        
        Args:
            texts: List of text strings to embed.
        
        Returns:
            Numpy array of embeddings, shape (n_texts, embedding_dim).
        """
        import numpy as np
        
        if not texts:
            return np.array([])
        
        return self._model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
    
    def _combine_sentences_for_embedding(
        self,
        sentences: List[Tuple[str, int, int]],
    ) -> List[str]:
        """Combine sentences into buffers for smoother similarity computation.
        
        Args:
            sentences: List of (text, start, end) tuples.
        
        Returns:
            List of combined text buffers.
        """
        buffer_size = self.semantic_config.buffer_size
        texts = [s[0] for s in sentences]
        
        if buffer_size == 1:
            return texts
        
        combined = []
        for i in range(len(texts)):
            start_idx = max(0, i - buffer_size + 1)
            end_idx = min(len(texts), i + buffer_size)
            combined.append(' '.join(texts[start_idx:end_idx]))
        
        return combined
    
    def _cosine_similarity(self, a: "np.ndarray", b: "np.ndarray") -> float:
        """Compute cosine similarity between two vectors.
        
        Args:
            a: First embedding vector.
            b: Second embedding vector.
        
        Returns:
            Cosine similarity (0 to 1).
        """
        import numpy as np
        
        dot = np.dot(a, b)
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        
        if norm_a == 0 or norm_b == 0:
            return 0.0
        
        return float(dot / (norm_a * norm_b))
    
    def _find_semantic_breakpoints(
        self,
        sentences: List[Tuple[str, int, int]],
    ) -> List[int]:
        """Find indices where semantic breakpoints should occur.
        
        Args:
            sentences: List of (text, start, end) tuples.
        
        Returns:
            List of indices after which to break (0-indexed into sentences).
        """
        if len(sentences) < 2:
            return []
        
        combined = self._combine_sentences_for_embedding(sentences)
        embeddings = self._compute_embeddings(combined)
        
        if len(embeddings) < 2:
            return []
        
        similarities = []
        for i in range(len(embeddings) - 1):
            sim = self._cosine_similarity(embeddings[i], embeddings[i + 1])
            similarities.append((i, sim))
        
        if self.semantic_config.breakpoint_percentile is not None:
            import numpy as np
            threshold = np.percentile(
                [s[1] for s in similarities],
                self.semantic_config.breakpoint_percentile
            )
        else:
            threshold = self.semantic_config.similarity_threshold
        
        breakpoints = []
        min_sentences = self.semantic_config.min_sentences_per_chunk
        last_break = -1
        
        for idx, sim in similarities:
            if sim < threshold and (idx - last_break) >= min_sentences:
                breakpoints.append(idx)
                last_break = idx
        
        return breakpoints
    
    def _create_spans_from_breakpoints(
        self,
        sentences: List[Tuple[str, int, int]],
        breakpoints: List[int],
        original_text: str,
    ) -> List[TextSpan]:
        """Create TextSpans by grouping sentences at breakpoints.
        
        Args:
            sentences: List of (text, start, end) tuples.
            breakpoints: Indices after which to break.
            original_text: Original normalized text for position reference.
        
        Returns:
            List of TextSpan objects.
        """
        if not sentences:
            return []
        
        if not breakpoints:
            text = ' '.join(s[0] for s in sentences)
            return [TextSpan(
                text=text,
                start=sentences[0][1],
                end=sentences[-1][2],
            )]
        
        spans = []
        break_set = set(breakpoints)
        current_sentences = []
        
        for i, (sent_text, start, end) in enumerate(sentences):
            current_sentences.append((sent_text, start, end))
            
            if i in break_set or i == len(sentences) - 1:
                if current_sentences:
                    span_text = ' '.join(s[0] for s in current_sentences)
                    span_start = current_sentences[0][1]
                    span_end = current_sentences[-1][2]
                    
                    spans.append(TextSpan(
                        text=span_text,
                        start=span_start,
                        end=span_end,
                    ))
                    current_sentences = []
        
        return spans
    
    def _create_chunks_with_overlap(
        self,
        spans: List[TextSpan],
        document_id: UUID,
        version_id: UUID,
        base_metadata: ChunkMetadata,
    ) -> List[Chunk]:
        """Create Chunk objects from spans, adding overlap between chunks.
        
        Args:
            spans: List of text spans.
            document_id: Parent document ID.
            version_id: Document version ID.
            base_metadata: Base metadata for all chunks.
        
        Returns:
            List of Chunk objects with overlap applied.
        """
        if not spans:
            return []
        
        chunks = []
        previous_text = ""
        
        for idx, span in enumerate(spans):
            chunk_text = span.text
            
            if idx > 0 and self.config.chunk_overlap > 0 and previous_text:
                overlap = create_overlap_text(previous_text, self.config.chunk_overlap)
                if overlap:
                    chunk_text = overlap + "\n\n" + chunk_text
            
            chunk = Chunk.create(
                document_id=document_id,
                version_id=version_id,
                chunk_index=idx,
                chunk_text=chunk_text.strip(),
                token_count=estimate_token_count(chunk_text),
                metadata=base_metadata,
                start_char_offset=span.start,
                end_char_offset=span.end,
            )
            chunks.append(chunk)
            previous_text = span.text
        
        return chunks
    
    def _create_single_chunk(
        self,
        text: str,
        document_id: UUID,
        version_id: UUID,
        base_metadata: ChunkMetadata,
    ) -> ChunkingResult:
        """Create a single chunk for very short documents.
        
        Args:
            text: Full text to put in one chunk.
            document_id: Parent document ID.
            version_id: Document version ID.
            base_metadata: Metadata for the chunk.
        
        Returns:
            ChunkingResult with a single chunk.
        """
        chunk = Chunk.create(
            document_id=document_id,
            version_id=version_id,
            chunk_index=0,
            chunk_text=text.strip(),
            token_count=estimate_token_count(text),
            metadata=base_metadata,
            start_char_offset=0,
            end_char_offset=len(text),
        )
        
        return self._create_result(document_id, version_id, [chunk])
    
    def _fallback_chunk(
        self,
        text: str,
        document_id: UUID,
        version_id: UUID,
        base_metadata: ChunkMetadata,
    ) -> ChunkingResult:
        """Fallback chunking when embeddings are unavailable.
        
        Uses sentence boundaries without semantic similarity,
        grouping sentences until chunk_size is reached.
        
        Args:
            text: Text to chunk.
            document_id: Parent document ID.
            version_id: Document version ID.
            base_metadata: Metadata for chunks.
        
        Returns:
            ChunkingResult using sentence-based fallback.
        """
        sentences = self._split_into_sentences(text)
        
        if not sentences:
            return self._create_single_chunk(text, document_id, version_id, base_metadata)
        
        spans = []
        current_sentences = []
        current_tokens = 0
        
        for sent_text, start, end in sentences:
            sent_tokens = estimate_token_count(sent_text)
            
            if current_tokens + sent_tokens > self.config.chunk_size and current_sentences:
                span_text = ' '.join(s[0] for s in current_sentences)
                spans.append(TextSpan(
                    text=span_text,
                    start=current_sentences[0][1],
                    end=current_sentences[-1][2],
                ))
                current_sentences = []
                current_tokens = 0
            
            current_sentences.append((sent_text, start, end))
            current_tokens += sent_tokens
        
        if current_sentences:
            span_text = ' '.join(s[0] for s in current_sentences)
            spans.append(TextSpan(
                text=span_text,
                start=current_sentences[0][1],
                end=current_sentences[-1][2],
            ))
        
        chunks = self._create_chunks_with_overlap(
            spans=spans,
            document_id=document_id,
            version_id=version_id,
            base_metadata=base_metadata,
        )
        
        return self._create_result(document_id, version_id, chunks)
