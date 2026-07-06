"""Faithfulness and citation evaluation for generated answers.

Implements best-practice RAG generation evaluation:
- Atomic claim decomposition
- Citation-level entailment (SUPPORTS / CONTRADICTS / NEUTRAL / NO_CITATION)
- Distinguishes citation correctness from coverage
- LLM-as-judge via Ollama with lexical fallback
- RAG Triad metrics: faithfulness, answer relevancy, citation quality
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Protocol

from libs.rag.context.models import AssembledContext
from libs.rag.generation.citations import citations_for_claim, extract_claims
from libs.rag.generation.config import GenerationConfig
from libs.rag.generation.models import GenerationResult
from libs.rag.retrieval.keyword import tokenize

logger = logging.getLogger(__name__)


class EntailmentLabel(str, Enum):
    SUPPORTS = "SUPPORTS"
    CONTRADICTS = "CONTRADICTS"
    NEUTRAL = "NEUTRAL"
    NO_CITATION = "NO_CITATION"


@dataclass
class ClaimEvaluation:
    """Evaluation of a single atomic claim."""

    claim: str
    citations: List[str]
    entailment: EntailmentLabel
    confidence: float = 0.0
    supporting_source: str = ""


@dataclass
class FaithfulnessResult:
    """Complete faithfulness evaluation for one generated answer."""

    query: str
    answer: str
    claims: List[ClaimEvaluation]
    faithfulness: float
    citation_precision: float
    citation_recall: float
    hallucination_rate: float
    citation_coverage: float
    answer_relevancy: float
    unsupported_claim_rate: float
    total_claims: int = 0
    supported_claims: int = 0
    refused: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "query": self.query,
            "faithfulness": self.faithfulness,
            "citation_precision": self.citation_precision,
            "citation_recall": self.citation_recall,
            "hallucination_rate": self.hallucination_rate,
            "citation_coverage": self.citation_coverage,
            "answer_relevancy": self.answer_relevancy,
            "unsupported_claim_rate": self.unsupported_claim_rate,
            "total_claims": self.total_claims,
            "supported_claims": self.supported_claims,
            "refused": self.refused,
        }


class JudgeClient(Protocol):
    def judge(self, prompt: str) -> str:
        ...


class LexicalJudge:
    """Deterministic entailment proxy using token overlap."""

    SUPPORT_THRESHOLD = 0.15
    CONTRADICT_KEYWORDS = {"not", "never", "false", "incorrect", "wrong", "no"}

    def judge_entailment(self, claim: str, source_text: str) -> EntailmentLabel:
        claim_tokens = set(tokenize(claim.lower()))
        source_tokens = set(tokenize(source_text.lower()))

        if not claim_tokens:
            return EntailmentLabel.NEUTRAL

        overlap = len(claim_tokens & source_tokens) / len(claim_tokens)

        claim_neg = bool(claim_tokens & self.CONTRADICT_KEYWORDS)
        source_neg = bool(source_tokens & self.CONTRADICT_KEYWORDS)
        if claim_neg != source_neg and overlap > 0.1:
            return EntailmentLabel.CONTRADICTS

        if overlap >= self.SUPPORT_THRESHOLD:
            return EntailmentLabel.SUPPORTS
        return EntailmentLabel.NEUTRAL


class OllamaJudge:
    """LLM-as-judge for claim entailment using Ollama."""

    JUDGE_PROMPT = """You are an evaluation judge for RAG systems. Determine if a source passage supports a claim.

Source passage:
{source}

Claim:
{claim}

Respond with ONLY one word: SUPPORTS, CONTRADICTS, or NEUTRAL.
- SUPPORTS: the source explicitly contains or implies the claim
- CONTRADICTS: the source contradicts the claim
- NEUTRAL: the source does not address the claim"""

    def __init__(self, config: Optional[GenerationConfig] = None) -> None:
        self.config = config or GenerationConfig()
        self._client = None

    def _get_client(self):
        if self._client is None:
            import httpx

            self._client = httpx.Client(
                base_url=self.config.base_url,
                timeout=self.config.timeout_seconds,
            )
        return self._client

    def judge(self, prompt: str) -> str:
        client = self._get_client()
        response = client.post(
            "/api/chat",
            json={
                "model": self.config.model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.0, "num_predict": 10},
            },
        )
        if response.status_code != 200:
            raise RuntimeError(f"Judge call failed: {response.status_code}")
        return response.json().get("message", {}).get("content", "").strip()

    def judge_entailment(self, claim: str, source_text: str) -> EntailmentLabel:
        prompt = self.JUDGE_PROMPT.format(source=source_text[:1500], claim=claim)
        try:
            raw = self.judge(prompt).upper()
            for label in EntailmentLabel:
                if label.value in raw:
                    return label
        except Exception as e:
            logger.warning(f"LLM judge failed, using lexical fallback: {e}")
        return LexicalJudge().judge_entailment(claim, source_text)


class FaithfulnessEvaluator:
    """Evaluate faithfulness and citation quality of generated answers."""

    def __init__(
        self,
        use_llm_judge: bool = False,
        judge_config: Optional[GenerationConfig] = None,
    ) -> None:
        self.use_llm_judge = use_llm_judge
        self._lexical_judge = LexicalJudge()
        self._llm_judge: Optional[OllamaJudge] = None
        if use_llm_judge:
            self._llm_judge = OllamaJudge(judge_config or GenerationConfig())

    def evaluate(
        self,
        generation: GenerationResult,
        context: AssembledContext,
    ) -> FaithfulnessResult:
        """Evaluate faithfulness of a generated answer against its context."""
        if generation.refused:
            return FaithfulnessResult(
                query=generation.query,
                answer=generation.answer,
                claims=[],
                faithfulness=1.0,
                citation_precision=1.0,
                citation_recall=1.0,
                hallucination_rate=0.0,
                citation_coverage=0.0,
                answer_relevancy=0.0,
                unsupported_claim_rate=0.0,
                refused=True,
            )

        claims_text = extract_claims(generation.answer)
        claim_evals: List[ClaimEvaluation] = []

        for claim in claims_text:
            claim_citations = citations_for_claim(
                generation.answer,
                claim,
                context,
            )
            if not claim_citations:
                claim_evals.append(
                    ClaimEvaluation(
                        claim=claim,
                        citations=[],
                        entailment=EntailmentLabel.NO_CITATION,
                    )
                )
                continue

            best_label = EntailmentLabel.NEUTRAL
            best_source = ""
            for citation in claim_citations:
                label = self._judge_entailment(claim, citation.source_text)
                if label == EntailmentLabel.SUPPORTS:
                    best_label = EntailmentLabel.SUPPORTS
                    best_source = citation.source_text[:200]
                    break
                if label == EntailmentLabel.CONTRADICTS:
                    best_label = EntailmentLabel.CONTRADICTS
                    best_source = citation.source_text[:200]
                elif best_label == EntailmentLabel.NEUTRAL:
                    best_label = label
                    best_source = citation.source_text[:200]

            claim_evals.append(
                ClaimEvaluation(
                    claim=claim,
                    citations=[c.label for c in claim_citations],
                    entailment=best_label,
                    supporting_source=best_source,
                )
            )

        return self._aggregate(generation, claim_evals)

    def evaluate_batch(
        self,
        generations: List[GenerationResult],
        contexts: List[AssembledContext],
    ) -> List[FaithfulnessResult]:
        if len(generations) != len(contexts):
            raise ValueError("generations and contexts must have same length")
        return [
            self.evaluate(gen, ctx)
            for gen, ctx in zip(generations, contexts)
        ]

    def _judge_entailment(self, claim: str, source_text: str) -> EntailmentLabel:
        if self._llm_judge is not None:
            return self._llm_judge.judge_entailment(claim, source_text)
        return self._lexical_judge.judge_entailment(claim, source_text)

    def _aggregate(
        self,
        generation: GenerationResult,
        claim_evals: List[ClaimEvaluation],
    ) -> FaithfulnessResult:
        total = len(claim_evals)
        if total == 0:
            return FaithfulnessResult(
                query=generation.query,
                answer=generation.answer,
                claims=[],
                faithfulness=0.0,
                citation_precision=0.0,
                citation_recall=0.0,
                hallucination_rate=1.0 if generation.answer else 0.0,
                citation_coverage=0.0,
                answer_relevancy=self._answer_relevancy(
                    generation.query, generation.answer
                ),
                unsupported_claim_rate=0.0,
            )

        supported = sum(
            1 for c in claim_evals if c.entailment == EntailmentLabel.SUPPORTS
        )
        no_citation = sum(
            1 for c in claim_evals if c.entailment == EntailmentLabel.NO_CITATION
        )
        contradicted = sum(
            1 for c in claim_evals if c.entailment == EntailmentLabel.CONTRADICTS
        )
        neutral = sum(
            1 for c in claim_evals if c.entailment == EntailmentLabel.NEUTRAL
        )

        total_citations = sum(len(c.citations) for c in claim_evals)
        supporting_citations = sum(
            1 for c in claim_evals if c.entailment == EntailmentLabel.SUPPORTS
        )

        faithfulness = supported / total
        citation_precision = (
            supporting_citations / total_citations if total_citations > 0 else 0.0
        )
        citation_recall = supported / total
        hallucination_rate = (no_citation + contradicted + neutral) / total
        unsupported_claim_rate = (no_citation + neutral) / total
        citation_coverage = (
            (total - no_citation) / total if total > 0 else 0.0
        )

        return FaithfulnessResult(
            query=generation.query,
            answer=generation.answer,
            claims=claim_evals,
            faithfulness=faithfulness,
            citation_precision=citation_precision,
            citation_recall=citation_recall,
            hallucination_rate=hallucination_rate,
            citation_coverage=citation_coverage,
            answer_relevancy=self._answer_relevancy(
                generation.query, generation.answer
            ),
            unsupported_claim_rate=unsupported_claim_rate,
            total_claims=total,
            supported_claims=supported,
        )

    def _answer_relevancy(self, query: str, answer: str) -> float:
        query_tokens = set(tokenize(query.lower()))
        answer_tokens = set(tokenize(answer.lower()))
        if not query_tokens or not answer_tokens:
            return 0.0
        return len(query_tokens & answer_tokens) / len(query_tokens)
