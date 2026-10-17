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


def test_llm_judge_verdict_word_wins_over_its_explanation(monkeypatch) -> None:
    """The judge answers one word, but models append explanations.

    "NEUTRAL - the source neither supports nor contradicts the claim" must
    parse as NEUTRAL: the verdict is the first word, not whichever label
    happens to appear first in enum order inside the explanation.
    """
    monkeypatch.setattr(
        OllamaJudge,
        "judge",
        lambda self, prompt: "NEUTRAL - the source neither SUPPORTS nor CONTRADICTS the claim",
    )
    judge = OllamaJudge()
    label, origin = judge.judge_entailment_with_origin("The sky is green.", "The sky is blue.")
    assert label == EntailmentLabel.NEUTRAL
    assert origin == "llm"


def test_llm_judge_leading_verdict_with_trailing_label_words(monkeypatch) -> None:
    monkeypatch.setattr(
        OllamaJudge,
        "judge",
        lambda self, prompt: "CONTRADICTS: the passage never SUPPORTS this claim",
    )
    judge = OllamaJudge()
    label, origin = judge.judge_entailment_with_origin("The sky is green.", "The sky is blue.")
    assert label == EntailmentLabel.CONTRADICTS
    assert origin == "llm"


def test_llm_judge_plain_verdict_with_punctuation_still_parses(monkeypatch) -> None:
    monkeypatch.setattr(OllamaJudge, "judge", lambda self, prompt: "Supports.")
    judge = OllamaJudge()
    label, origin = judge.judge_entailment_with_origin("The sky is blue.", "The sky is blue.")
    assert label == EntailmentLabel.SUPPORTS
    assert origin == "llm"


def test_llm_judge_verdict_wrapped_in_markdown_or_quotes(monkeypatch) -> None:
    """Models often wrap the one-word verdict: **SUPPORTS**, "NEUTRAL".

    Leading delimiters are not the verdict; the first actual word is.
    """
    judge = OllamaJudge()
    for raw, want in [
        ("**SUPPORTS**", EntailmentLabel.SUPPORTS),
        ('"NEUTRAL"', EntailmentLabel.NEUTRAL),
        ("(CONTRADICTS)", EntailmentLabel.CONTRADICTS),
    ]:
        monkeypatch.setattr(OllamaJudge, "judge", lambda self, prompt, r=raw: r)
        label, origin = judge.judge_entailment_with_origin("c", "s")
        assert label == want, raw
        assert origin == "llm", raw
