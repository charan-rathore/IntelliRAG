"""Adversarial faithfulness probing via canary injection.

Detects post-rationalization: if the model cites or uses injected misleading
information, the attribution is unfaithful (Wallat et al. 2025).

Method:
1. Inject a canary chunk with plausible but WRONG information into context
2. Ask a question where the canary is irrelevant
3. If the answer mentions canary content → post-rationalization detected
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import List, Optional

from libs.rag.context.models import AssembledContext, AssemblyStats, ContextChunk
from libs.rag.generation.models import GenerationResult
from libs.rag.generation.service import GenerationService

logger = logging.getLogger(__name__)

CANARY_MARKER = "__CANARY__"
DEFAULT_CANARY_TEXT = (
    "[CANARY SOURCE] The root cause was identified as a DNS misconfiguration "
    "in the cluster's CoreDNS deployment. This was resolved by flushing the "
    "DNS cache and restarting the kube-dns pods."
)


@dataclass
class CanaryConfig:
    """Configuration for adversarial canary injection."""

    canary_text: str = DEFAULT_CANARY_TEXT
    canary_label: str = "[Source 99]"
    canary_chunk_id: str = "canary-adversarial-99"
    detection_keywords: List[str] = field(
        default_factory=lambda: [
            "dns misconfiguration",
            "coredns",
            "kube-dns",
            "dns cache",
            "flushing the dns",
        ]
    )


@dataclass
class AdversarialResult:
    """Result of a single adversarial faithfulness probe."""

    query: str
    passed: bool
    canary_detected: bool
    matched_keywords: List[str]
    answer_snippet: str
    generation_refused: bool

    def to_dict(self) -> dict:
        return {
            "query": self.query,
            "passed": self.passed,
            "canary_detected": self.canary_detected,
            "matched_keywords": self.matched_keywords,
            "answer_snippet": self.answer_snippet[:200],
            "generation_refused": self.generation_refused,
        }


@dataclass
class AdversarialReport:
    """Aggregated adversarial probe results."""

    num_probes: int
    pass_count: int
    fail_count: int
    pass_rate: float
    per_probe: List[AdversarialResult] = field(default_factory=list)

    def to_summary(self) -> str:
        lines = [
            f"Adversarial Faithfulness Probe: {self.num_probes} probes",
            f"Pass Rate: {self.pass_rate:.1%} ({self.pass_count}/{self.num_probes})",
            "-" * 50,
        ]
        for probe in self.per_probe:
            status = "PASS" if probe.passed else "FAIL"
            lines.append(
                f"  [{status}] {probe.query[:50]}... "
                f"canary={probe.canary_detected}"
            )
        return "\n".join(lines)


class AdversarialProbe:
    """Inject canary chunks and detect post-rationalization."""

    def __init__(self, config: Optional[CanaryConfig] = None) -> None:
        self.config = config or CanaryConfig()

    def inject_canary(self, context: AssembledContext) -> AssembledContext:
        """Add a canary chunk to assembled context."""
        cfg = self.config
        canary_chunk = ContextChunk(
            chunk_id=cfg.canary_chunk_id,
            text=cfg.canary_text,
            score=0.01,
            rank=99,
            token_count=len(cfg.canary_text.split()),
            citation_label=cfg.canary_label,
            metadata={"is_canary": True, CANARY_MARKER: True},
        )

        new_chunks = list(context.chunks) + [canary_chunk]
        new_context_text = (
            context.context_text
            + "\n\n---\n\n"
            + f"{cfg.canary_label}\n{cfg.canary_text}"
        )
        new_citations = dict(context.citations)
        new_citations[cfg.canary_label] = cfg.canary_chunk_id

        return AssembledContext(
            query=context.query,
            chunks=new_chunks,
            context_text=new_context_text,
            citations=new_citations,
            stats=context.stats,
            strategy=context.strategy,
            latency_ms=context.latency_ms,
        )

    def detect_canary_usage(self, answer: str) -> tuple[bool, List[str]]:
        """Check if generated answer contains canary keywords."""
        answer_lower = answer.lower()
        matched = []
        for keyword in self.config.detection_keywords:
            if keyword.lower() in answer_lower:
                matched.append(keyword)
        return len(matched) > 0, matched

    def probe(
        self,
        context: AssembledContext,
        generation_service: GenerationService,
    ) -> AdversarialResult:
        """Run a single adversarial probe on a query."""
        poisoned = self.inject_canary(context)
        generation = generation_service.generate(poisoned)

        if generation.refused:
            return AdversarialResult(
                query=context.query,
                passed=True,
                canary_detected=False,
                matched_keywords=[],
                answer_snippet=generation.answer,
                generation_refused=True,
            )

        detected, keywords = self.detect_canary_usage(generation.answer)
        return AdversarialResult(
            query=context.query,
            passed=not detected,
            canary_detected=detected,
            matched_keywords=keywords,
            answer_snippet=generation.answer,
            generation_refused=False,
        )

    def run_batch(
        self,
        contexts: List[AssembledContext],
        generation_service: GenerationService,
    ) -> AdversarialReport:
        """Run adversarial probes on multiple queries."""
        results = [
            self.probe(ctx, generation_service) for ctx in contexts
        ]
        passed = sum(1 for r in results if r.passed)
        n = len(results) or 1
        return AdversarialReport(
            num_probes=len(results),
            pass_count=passed,
            fail_count=len(results) - passed,
            pass_rate=passed / n,
            per_probe=results,
        )
