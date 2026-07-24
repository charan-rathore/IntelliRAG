"""Tests for LLM generation layer."""

from __future__ import annotations

from libs.rag.context.config import ContextAssemblyConfig
from libs.rag.context.models import AssembledContext, AssemblyStats, ContextChunk
from libs.rag.context.service import ContextAssemblyService
from libs.rag.evaluation.faithfulness import FaithfulnessEvaluator
from libs.rag.evaluation.generation_benchmark import GenerationBenchmark
from libs.rag.evaluation.models import EvaluationDataset, EvaluationSample
from libs.rag.generation.citations import extract_claims, parse_citations
from libs.rag.generation.config import GenerationConfig
from libs.rag.generation.ollama import MockLLMClient
from libs.rag.generation.prompts import build_messages, build_system_prompt
from libs.rag.generation.service import GenerationService
from libs.rag.retrieval.models import RetrievedChunk


CHUNKS = [
    RetrievedChunk(
        chunk_id="c1",
        text="Resource fragmentation on cluster nodes causes pod scheduling failures.",
        score=0.9,
        rank=1,
        retriever="hybrid",
        metadata={"document_id": "k8s"},
    ),
    RetrievedChunk(
        chunk_id="c2",
        text="Individual nodes had fragmented CPU and memory allocations.",
        score=0.85,
        rank=2,
        retriever="hybrid",
        metadata={"document_id": "k8s"},
    ),
]


def _assembled_context(query: str = "What causes pod scheduling failures?") -> AssembledContext:
    service = ContextAssemblyService(ContextAssemblyConfig(strategy="top_k", max_chunks=2))
    return service.assemble(query, CHUNKS)


class TestPrompts:
    def test_citation_aware_system_prompt(self):
        cfg = GenerationConfig(prompt_style="citation_aware")
        prompt = build_system_prompt(cfg)
        assert "Source" in prompt
        assert "cite" in prompt.lower()

    def test_build_messages_includes_context(self):
        ctx = _assembled_context()
        messages = build_messages(ctx, GenerationConfig())
        assert len(messages) == 2
        assert ctx.query in messages[1]["content"]
        assert "[Source 1]" in messages[1]["content"]


class TestCitations:
    def test_parse_citations(self):
        ctx = _assembled_context()
        answer = (
            "Pod failures are caused by resource fragmentation [Source 1]. "
            "Nodes had fragmented allocations [Source 2]."
        )
        citations = parse_citations(answer, ctx)
        assert len(citations) == 2
        assert citations[0].chunk_id == "c1"
        assert citations[1].chunk_id == "c2"

    def test_extract_claims(self):
        answer = (
            "Resource fragmentation causes failures [Source 1]. "
            "Nodes had fragmented CPU [Source 2]."
        )
        claims = extract_claims(answer)
        assert len(claims) == 2

    def test_extract_claims_handles_refusal(self):
        claims = extract_claims("I cannot answer based on the provided sources.")
        assert claims == []

    def test_trailing_citation_stays_with_claim(self):
        from libs.rag.generation.citations import citations_for_claim

        ctx = _assembled_context()
        answer = (
            "Resource fragmentation on cluster nodes causes pod scheduling failures. "
            "[Source 1]"
        )
        claims = extract_claims(answer)
        assert len(claims) == 1
        linked = citations_for_claim(answer, claims[0], ctx)
        assert len(linked) == 1
        assert linked[0].source_index == 1

    def test_normalize_bare_numeric_citations(self):
        from libs.rag.generation.citations import normalize_answer_citations, parse_citations

        ctx = _assembled_context()
        raw = (
            "Resource fragmentation caused the failures [1]. "
            "Nodes had fragmented allocations [1].\n\n"
            "[1] # Kubernetes Pod Scheduling Failures"
        )
        cleaned = normalize_answer_citations(raw)
        assert "[Source 1]" in cleaned
        assert "# Kubernetes" not in cleaned
        citations = parse_citations(cleaned, ctx)
        assert len(citations) >= 1


class TestGenerationService:
    def test_generate_with_mock_llm(self):
        mock = MockLLMClient()
        service = GenerationService(
            config=GenerationConfig(),
            llm_client=mock,
        )
        ctx = _assembled_context()
        result = service.generate(ctx)

        assert result.answer
        assert result.has_citations
        assert len(result.citations) >= 1
        assert result.model == "mock-llm"
        assert result.latency_ms >= 0

    def test_refusal_on_empty_context(self):
        service = GenerationService(llm_client=MockLLMClient())
        empty_ctx = AssembledContext(
            query="test",
            chunks=[],
            context_text="",
            citations={},
            stats=AssemblyStats(),
            strategy="top_k",
        )
        result = service.generate(empty_ctx)
        assert result.refused
        assert not result.has_citations

    def test_mock_refuses_off_topic_context_echo(self):
        """Mock must not dump unrelated source text for meta questions."""
        from libs.rag.generation.service import REFUSAL_PHRASE

        mock = MockLLMClient()
        service = GenerationService(llm_client=mock)
        ctx = _assembled_context("what are the things can i ask here about?")
        result = service.generate(ctx)
        assert result.refused or REFUSAL_PHRASE.lower() in result.answer.lower()
        assert "Kubernetes Pod Scheduling Failures" not in result.answer


class TestFaithfulness:
    def test_faithful_answer_scores_high(self):
        mock = MockLLMClient()
        service = GenerationService(llm_client=mock)
        ctx = _assembled_context()
        generation = service.generate(ctx)

        evaluator = FaithfulnessEvaluator(use_llm_judge=False)
        result = evaluator.evaluate(generation, ctx)

        assert result.faithfulness >= 0.5
        assert result.citation_coverage > 0.0
        assert result.total_claims >= 1

    def test_refusal_scores_perfect_faithfulness(self):
        evaluator = FaithfulnessEvaluator()
        from libs.rag.generation.models import GenerationResult, GenerationStats

        gen = GenerationResult(
            query="test",
            answer="I cannot answer based on the provided sources.",
            citations=[],
            model="mock",
            stats=GenerationStats(),
            refused=True,
        )
        ctx = _assembled_context()
        result = evaluator.evaluate(gen, ctx)
        assert result.faithfulness == 1.0
        assert result.refused


class TestGenerationBenchmark:
    def test_benchmark_with_mock_pipeline(self):
        mock = MockLLMClient()
        service = GenerationService(llm_client=mock)
        evaluator = FaithfulnessEvaluator()
        benchmark = GenerationBenchmark(service, evaluator)

        dataset = EvaluationDataset(
            name="test",
            samples=[
                EvaluationSample(
                    question="What causes pod scheduling failures?",
                    ground_truth="Resource fragmentation on nodes.",
                    reference_context=["resource fragmentation"],
                ),
            ],
        )

        def context_fn(question: str) -> AssembledContext:
            return _assembled_context(question)

        result = benchmark.run(dataset, context_fn)
        assert result.num_queries == 1
        assert result.avg_faithfulness > 0.0
        assert result.citation_rate > 0.0
