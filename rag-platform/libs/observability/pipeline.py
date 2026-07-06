"""Instrumented RAG pipeline with full observability."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

from libs.rag.context.config import ContextAssemblyConfig
from libs.rag.context.service import ContextAssemblyService
from libs.rag.evaluation.faithfulness import FaithfulnessEvaluator
from libs.rag.generation.models import GenerationResult
from libs.rag.generation.service import GenerationService
from libs.rag.reranking.service import RerankingService
from libs.rag.retrieval.service import RetrievalService
from libs.shared.logging.structured import get_logger, log_event

from .collector import ObservabilityCollector
from .metrics import get_registry
from .tracing import SpanContext, Tracer

logger = get_logger("rag.pipeline")


@dataclass
class ObservedQueryResult:
    """Result of an instrumented RAG query."""

    query: str
    answer: str
    trace_id: str
    generation: GenerationResult
    faithfulness: float
    total_latency_ms: float
    layer_latencies: Dict[str, float]
    eval_scores: Dict[str, float]
    refused: bool

    def to_dict(self) -> Dict:
        return {
            "query": self.query,
            "answer": self.answer[:500],
            "trace_id": self.trace_id,
            "faithfulness": self.faithfulness,
            "total_latency_ms": round(self.total_latency_ms, 2),
            "layer_latencies": {k: round(v, 2) for k, v in self.layer_latencies.items()},
            "eval_scores": self.eval_scores,
            "refused": self.refused,
            "model": self.generation.model,
            "citations": len(self.generation.citations),
        }


class ObservedRAGPipeline:
    """Full RAG pipeline with metrics, tracing, and eval score attachment."""

    def __init__(
        self,
        retrieval_service: RetrievalService,
        reranking_service: RerankingService,
        context_service: ContextAssemblyService,
        generation_service: GenerationService,
        faithfulness_evaluator: Optional[FaithfulnessEvaluator] = None,
        collector: Optional[ObservabilityCollector] = None,
        tracer: Optional[Tracer] = None,
    ) -> None:
        self.retrieval = retrieval_service
        self.reranking = reranking_service
        self.context = context_service
        self.generation = generation_service
        self.faithfulness = faithfulness_evaluator or FaithfulnessEvaluator()
        self.collector = collector or ObservabilityCollector()
        self.tracer = tracer or Tracer("rag-pipeline")

    def query(
        self,
        question: str,
        retrieval_mode: str = "hybrid",
        top_k: int = 5,
    ) -> ObservedQueryResult:
        """Execute a full instrumented RAG query."""
        layer_latencies: Dict[str, float] = {}
        eval_scores: Dict[str, float] = {}
        start = time.monotonic()

        with SpanContext(self.tracer, "rag_query", is_root=True, query=question[:100]) as root:
            trace_id = root.trace_id

            # Layer 1: Retrieval
            with SpanContext(self.tracer, "retrieval", layer="retrieval") as span:
                t0 = time.monotonic()
                retrieval_result = self.retrieval.retrieve(
                    query=question, mode=retrieval_mode, top_k=top_k * 4
                )
                layer_latencies["retrieval"] = (time.monotonic() - t0) * 1000
                span.set_attribute("chunks_retrieved", len(retrieval_result.chunks))
                span.set_attribute("latency_ms", layer_latencies["retrieval"])
                self.collector.record_layer_latency("retrieval", layer_latencies["retrieval"])

            # Layer 2: Reranking
            with SpanContext(self.tracer, "reranking", layer="reranking") as span:
                t0 = time.monotonic()
                rerank_result = self.reranking.rerank_only(
                    query=question, retrieval_result=retrieval_result, top_k=top_k
                )
                layer_latencies["reranking"] = (time.monotonic() - t0) * 1000
                span.set_attribute("chunks_reranked", len(rerank_result.chunks))
                self.collector.record_layer_latency("reranking", layer_latencies["reranking"])

            # Layer 3: Context Assembly
            with SpanContext(self.tracer, "context_assembly", layer="context") as span:
                t0 = time.monotonic()
                assembled = self.context.assemble_from_rerank(rerank_result)
                layer_latencies["context"] = (time.monotonic() - t0) * 1000
                span.set_attribute("context_tokens", assembled.total_tokens)
                span.set_attribute("chunks_selected", len(assembled.chunks))
                self.collector.record_layer_latency("context", layer_latencies["context"])

            # Layer 4: Generation
            with SpanContext(self.tracer, "generation", layer="generation") as span:
                t0 = time.monotonic()
                generation = self.generation.generate(assembled)
                layer_latencies["generation"] = (time.monotonic() - t0) * 1000
                span.set_attribute("model", generation.model)
                span.set_attribute("refused", generation.refused)
                span.set_attribute("citations", len(generation.citations))
                self.collector.record_layer_latency("generation", layer_latencies["generation"])

            # Layer 5: Faithfulness eval (span-attached scoring)
            with SpanContext(self.tracer, "faithfulness_eval", layer="eval") as span:
                t0 = time.monotonic()
                faith_result = self.faithfulness.evaluate(generation, assembled)
                layer_latencies["eval"] = (time.monotonic() - t0) * 1000

                eval_scores = {
                    "faithfulness": faith_result.faithfulness,
                    "citation_precision": faith_result.citation_precision,
                    "hallucination_rate": faith_result.hallucination_rate,
                    "answer_relevancy": faith_result.answer_relevancy,
                }
                for metric, value in eval_scores.items():
                    span.set_eval_score(metric, value)
                    root.set_eval_score(metric, value)
                    self.collector.record_eval_score(metric, value)

                self.collector.record_layer_latency("eval", layer_latencies["eval"])

            total_ms = (time.monotonic() - start) * 1000
            get_registry().histogram("rag_e2e_latency_ms").observe(total_ms)

            success = not generation.refused and faith_result.faithfulness > 0.3
            self.collector.record_query(success=success)

            log_event(logger, "rag_query_completed", "RAG query completed", {
                "trace_id": trace_id,
                "total_latency_ms": round(total_ms, 2),
                "faithfulness": faith_result.faithfulness,
                "refused": generation.refused,
            })

            return ObservedQueryResult(
                query=question,
                answer=generation.answer,
                trace_id=trace_id,
                generation=generation,
                faithfulness=faith_result.faithfulness,
                total_latency_ms=total_ms,
                layer_latencies=layer_latencies,
                eval_scores=eval_scores,
                refused=generation.refused,
            )
