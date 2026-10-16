"""Regression: a fallback verdict must not wear the LLM judge's authority.

When the Ollama judge fails (or answers something unparseable), the lexical
proxy decides - and the evaluation must say so, or benchmark readers trust a
weaker verdict as a judged one.
"""

from __future__ import annotations

from libs.rag.context.models import AssembledContext, AssemblyStats, ContextChunk
from libs.rag.evaluation.faithfulness import (
    EntailmentLabel,
    FaithfulnessEvaluator,
    OllamaJudge,
)
from libs.rag.generation.models import GenerationResult, GenerationStats


def _context() -> AssembledContext:
    chunk = ContextChunk(
        chunk_id="c1",
        text="The sky is blue and clear over the city.",
        score=0.9,
        rank=1,
        token_count=9,
        citation_label="Source 1",
    )
    return AssembledContext(
        query="What colour is the sky?",
        chunks=[chunk],
        context_text=chunk.text,
        citations=[],
        stats=AssemblyStats(),
        strategy="test",
    )


def _generation() -> GenerationResult:
    return GenerationResult(
        query="What colour is the sky?",
        answer="The sky is blue. [Source 1]",
        citations=[],
        model="test",
        stats=GenerationStats(),
    )


def test_llm_judge_success_marks_verdict_as_llm(monkeypatch) -> None:
    monkeypatch.setattr(OllamaJudge, "judge", lambda self, prompt: "SUPPORTS")
    result = FaithfulnessEvaluator(use_llm_judge=True).evaluate(_generation(), _context())
    assert result.claims[0].entailment == EntailmentLabel.SUPPORTS
    assert result.claims[0].judge == "llm"
    assert result.metadata["judge_fallbacks"] == 0


def test_llm_judge_failure_is_labelled_fallback(monkeypatch) -> None:
    def _boom(self, prompt):
        raise RuntimeError("ollama down")

    monkeypatch.setattr(OllamaJudge, "judge", _boom)
    result = FaithfulnessEvaluator(use_llm_judge=True).evaluate(_generation(), _context())
    assert result.claims[0].judge == "llm-fallback-lexical"
    assert result.metadata["judge_fallbacks"] == 1


def test_llm_judge_unparseable_verdict_is_labelled_fallback(monkeypatch) -> None:
    monkeypatch.setattr(OllamaJudge, "judge", lambda self, prompt: "I am not sure, maybe?")
    result = FaithfulnessEvaluator(use_llm_judge=True).evaluate(_generation(), _context())
    assert result.claims[0].judge == "llm-fallback-lexical"
    assert result.metadata["judge_fallbacks"] == 1


def test_plain_lexical_evaluator_marks_verdicts_lexical() -> None:
    result = FaithfulnessEvaluator(use_llm_judge=False).evaluate(_generation(), _context())
    assert result.claims[0].judge == "lexical"
    assert "judge_fallbacks" not in result.metadata
