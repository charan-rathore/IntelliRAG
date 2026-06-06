"""Tests for the chunking benchmark system."""

import pytest

from libs.rag.evaluation.models import (
    ChunkingEvalResult,
    EvaluationDataset,
    EvaluationSample,
    StrategyComparison,
)
from libs.rag.evaluation.benchmark import (
    ChunkingBenchmark,
    SimpleRetriever,
    quick_benchmark,
)
from libs.rag.evaluation.sample_dataset import (
    create_sample_kubernetes_dataset,
    get_sample_documents,
)


class TestEvaluationModels:
    """Tests for evaluation data models."""
    
    def test_evaluation_sample_creation(self):
        """Test creating an evaluation sample."""
        sample = EvaluationSample(
            question="What is X?",
            ground_truth="X is a thing.",
            reference_context=["X is a thing that does Y."],
        )
        
        assert sample.question == "What is X?"
        assert sample.ground_truth == "X is a thing."
        assert len(sample.reference_context) == 1
        assert sample.sample_id is not None
    
    def test_evaluation_sample_serialization(self):
        """Test sample round-trip serialization."""
        sample = EvaluationSample(
            question="How does Y work?",
            ground_truth="Y works by doing Z.",
            reference_context=["Y is a mechanism.", "Y does Z."],
            document_id="doc1",
            metadata={"difficulty": "easy"},
        )
        
        data = sample.to_dict()
        restored = EvaluationSample.from_dict(data)
        
        assert restored.question == sample.question
        assert restored.ground_truth == sample.ground_truth
        assert restored.reference_context == sample.reference_context
        assert restored.document_id == sample.document_id
        assert restored.metadata == sample.metadata
    
    def test_evaluation_dataset_creation(self):
        """Test creating an evaluation dataset."""
        samples = [
            EvaluationSample(
                question="Q1",
                ground_truth="A1",
                reference_context=["Context 1"],
            ),
            EvaluationSample(
                question="Q2",
                ground_truth="A2",
                reference_context=["Context 2"],
            ),
        ]
        
        dataset = EvaluationDataset(
            name="test_dataset",
            samples=samples,
        )
        
        assert len(dataset) == 2
        assert dataset.name == "test_dataset"
    
    def test_dataset_to_ragas_format(self):
        """Test converting dataset to RAGAS format."""
        samples = [
            EvaluationSample(
                question="What is X?",
                ground_truth="X is Y.",
                reference_context=["X is defined as Y."],
            ),
        ]
        dataset = EvaluationDataset(name="test", samples=samples)
        
        retrieved = {samples[0].sample_id: ["Retrieved chunk about X."]}
        
        ragas_data = dataset.to_ragas_format(retrieved)
        
        assert "question" in ragas_data
        assert "contexts" in ragas_data
        assert "ground_truth" in ragas_data
        assert "answer" in ragas_data
        assert ragas_data["question"] == ["What is X?"]
    
    def test_chunking_eval_result_combined_score(self):
        """Test F1 score calculation."""
        result = ChunkingEvalResult(
            strategy_name="recursive",
            chunk_size=512,
            chunk_overlap=50,
            context_precision=0.8,
            context_recall=0.6,
        )
        
        expected_f1 = 2 * 0.8 * 0.6 / (0.8 + 0.6)
        assert abs(result.combined_score - expected_f1) < 0.001
    
    def test_chunking_eval_result_zero_scores(self):
        """Test F1 score with zero values."""
        result = ChunkingEvalResult(
            strategy_name="recursive",
            chunk_size=512,
            chunk_overlap=50,
            context_precision=0.0,
            context_recall=0.0,
        )
        
        assert result.combined_score == 0.0
    
    def test_strategy_comparison_finds_best(self):
        """Test that comparison identifies best strategy."""
        results = [
            ChunkingEvalResult(
                strategy_name="recursive",
                chunk_size=512,
                chunk_overlap=50,
                context_precision=0.7,
                context_recall=0.6,
            ),
            ChunkingEvalResult(
                strategy_name="structure_aware",
                chunk_size=512,
                chunk_overlap=50,
                context_precision=0.8,
                context_recall=0.8,
            ),
        ]
        
        comparison = StrategyComparison(
            dataset_name="test",
            results=results,
        )
        
        assert comparison.best_strategy == "structure_aware"
        assert comparison.best_config["strategy"] == "structure_aware"


class TestSimpleRetriever:
    """Tests for the lexical retriever."""
    
    def test_retrieve_returns_relevant_chunks(self):
        """Test that retriever returns chunks with matching terms."""
        chunks = [
            ("1", "Kubernetes pods are scheduled on nodes."),
            ("2", "Docker containers run applications."),
            ("3", "The scheduler places pods based on resources."),
        ]
        
        retriever = SimpleRetriever(chunks)
        results = retriever.retrieve("How are pods scheduled?", top_k=2)
        
        assert len(results) == 2
        assert any("pods" in r.lower() and "schedul" in r.lower() for r in results)
    
    def test_retrieve_respects_top_k(self):
        """Test that retriever respects top_k limit."""
        chunks = [(str(i), f"Chunk {i} content") for i in range(10)]
        
        retriever = SimpleRetriever(chunks)
        results = retriever.retrieve("content", top_k=3)
        
        assert len(results) == 3


class TestChunkingBenchmark:
    """Tests for the benchmark runner."""
    
    def test_run_single_produces_results(self):
        """Test running a single benchmark configuration."""
        dataset = create_sample_kubernetes_dataset()
        documents = get_sample_documents()
        
        benchmark = ChunkingBenchmark(
            dataset=dataset,
            source_documents=documents,
            use_embeddings=False,
        )
        
        result = benchmark.run_single(
            strategy="recursive",
            chunk_size=512,
            chunk_overlap=50,
        )
        
        assert result.strategy_name == "recursive"
        assert result.chunk_size == 512
        assert result.total_chunks > 0
        assert 0 <= result.context_precision <= 1
        assert 0 <= result.context_recall <= 1
    
    def test_run_comparison_multiple_strategies(self):
        """Test comparing multiple strategies."""
        samples = [
            EvaluationSample(
                question="What is CPU?",
                ground_truth="CPU is the processor.",
                reference_context=["CPU is specified in cores."],
            ),
        ]
        dataset = EvaluationDataset(name="mini_test", samples=samples)
        documents = {"doc": "CPU is specified in cores. Memory is specified in bytes."}
        
        benchmark = ChunkingBenchmark(
            dataset=dataset,
            source_documents=documents,
        )
        
        results = benchmark.run_comparison(
            strategies=["recursive", "structure_aware"],
            chunk_sizes=[256],
            overlaps=[25],
        )
        
        assert len(results.results) == 2
        assert results.best_strategy is not None
    
    def test_quick_benchmark_convenience_function(self):
        """Test the quick_benchmark convenience function."""
        documents = {"doc": "The quick brown fox jumps over the lazy dog."}
        questions = ["What does the fox do?"]
        ground_truths = ["The fox jumps over the lazy dog."]
        
        results = quick_benchmark(
            documents=documents,
            questions=questions,
            ground_truths=ground_truths,
            strategies=["recursive"],
        )
        
        assert results.dataset_name == "quick_benchmark"
        assert len(results.results) > 0


class TestSampleDataset:
    """Tests for sample dataset creation."""
    
    def test_kubernetes_dataset_valid(self):
        """Test that Kubernetes dataset has valid structure."""
        dataset = create_sample_kubernetes_dataset()
        
        assert len(dataset) > 0
        assert dataset.name == "kubernetes_scheduling_eval"
        
        for sample in dataset:
            assert sample.question
            assert sample.ground_truth
            assert len(sample.reference_context) > 0
    
    def test_sample_documents_not_empty(self):
        """Test that sample documents contain content."""
        documents = get_sample_documents()
        
        assert len(documents) > 0
        for doc_id, content in documents.items():
            assert len(content) > 100
