"""Unified RAG evaluation platform orchestrator.

Runs end-to-end evaluation across all pipeline layers:
  Retrieval → Reranking → Context Assembly → Generation → Faithfulness

Tracks:
- Retrieval metrics (Recall, Precision, MRR, NDCG)
- Generation metrics (Faithfulness, Citation accuracy, Hallucination)
- Operational metrics (Latency per layer, E2E throughput)
- Adversarial faithfulness probes
- Quality gate with CI-ready pass/fail
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Dict, List, Optional

from libs.rag.context.models import AssembledContext
from libs.rag.context.service import ContextAssemblyService
from libs.rag.evaluation.adversarial import AdversarialProbe
from libs.rag.evaluation.baseline import BaselineStore
from libs.rag.evaluation.context_benchmark import ContextBenchmark
from libs.rag.evaluation.faithfulness import FaithfulnessEvaluator
from libs.rag.evaluation.generation_benchmark import GenerationBenchmark
from libs.rag.evaluation.metrics import LayerMetrics, compute_distribution
from libs.rag.evaluation.models import EvaluationDataset
from libs.rag.evaluation.parameters import PipelineParameters
from libs.rag.evaluation.quality_gate import QualityGate
from libs.rag.evaluation.report import EvalReport
from libs.rag.evaluation.reranking_benchmark import RerankingBenchmark
from libs.rag.evaluation.retrieval_benchmark import RetrievalBenchmark
from libs.rag.evaluation.thresholds import QualityGateConfig
from libs.rag.generation.service import GenerationService
from libs.rag.reranking.service import RerankingService
from libs.rag.retrieval.service import RetrievalService

logger = logging.getLogger(__name__)


@dataclass
class PipelineHandles:
    """Injectable pipeline components for evaluation."""

    retrieval_service: RetrievalService
    reranking_service: RerankingService
    context_service: ContextAssemblyService
    generation_service: GenerationService
    faithfulness_evaluator: FaithfulnessEvaluator
    corpus: List[tuple[str, str]]
    chunk_doc_ids: Dict[str, str] = field(default_factory=dict)


class EvaluationPlatform:
    """Unified evaluation platform for the full RAG pipeline."""

    def __init__(
        self,
        dataset: EvaluationDataset,
        pipeline: PipelineHandles,
        parameters: Optional[PipelineParameters] = None,
        quality_gate_config: Optional[QualityGateConfig] = None,
        baseline_dir: Optional[str] = None,
    ) -> None:
        self.dataset = dataset
        self.pipeline = pipeline
        self.parameters = parameters or PipelineParameters(
            run_id=str(uuid.uuid4()),
            timestamp=datetime.now().isoformat(),
            dataset_name=dataset.name,
            dataset_version=dataset.version,
            num_samples=len(dataset),
        )
        self.quality_gate = QualityGate(
            config=quality_gate_config or QualityGateConfig(),
            baseline_store=BaselineStore(baseline_dir) if baseline_dir else None,
        )
        self.baseline_store = BaselineStore(baseline_dir) if baseline_dir else None
        self.adversarial_probe = AdversarialProbe()

    def run(
        self,
        run_adversarial: bool = True,
        check_quality_gate: bool = True,
        compare_baseline: bool = True,
        baseline_filename: str = "latest.json",
    ) -> EvalReport:
        """Run full pipeline evaluation and produce report."""
        start = time.time()
        per_sample: Dict[str, List[float]] = {}
        aggregate: Dict[str, float] = {}
        layer_metrics: Dict[str, LayerMetrics] = {}
        operational: Dict[str, float] = {}

        question_to_doc = {
            s.question: s.document_id
            for s in self.dataset.samples
            if s.document_id
        }

        def _doc_filter(query: str) -> Optional[Dict[str, str]]:
            doc_key = question_to_doc.get(query)
            return {"source_doc_id": doc_key} if doc_key else None

        # --- Layer 1: Retrieval ---
        logger.info("Evaluating retrieval layer...")
        retrieval_bench = RetrievalBenchmark(
            self.dataset,
            self.pipeline.corpus,
            chunk_doc_ids=self.pipeline.chunk_doc_ids,
        )

        retrieval_mode = self.parameters.retrieval_mode

        def hybrid_retrieve(query: str, top_k: int):
            return self.pipeline.retrieval_service.retrieve(
                query=query,
                mode=retrieval_mode,
                top_k=top_k,
                filter_metadata=_doc_filter(query),
            )

        retrieval_result = retrieval_bench.evaluate_retriever(
            hybrid_retrieve, retrieval_mode, top_k=self.parameters.retrieval_top_k
        )

        per_sample["retrieval_mrr"] = [q.mrr for q in retrieval_result.per_query]
        per_sample["retrieval_recall"] = [q.recall_at_k for q in retrieval_result.per_query]
        per_sample["retrieval_precision"] = [q.precision_at_k for q in retrieval_result.per_query]
        per_sample["retrieval_latency_ms"] = [q.latency_ms for q in retrieval_result.per_query]

        aggregate["retrieval_mrr"] = retrieval_result.avg_mrr
        aggregate["retrieval_recall"] = retrieval_result.avg_recall_at_k
        aggregate["retrieval_precision"] = retrieval_result.avg_precision_at_k
        aggregate["retrieval_ndcg"] = retrieval_result.avg_ndcg_at_k

        layer_metrics["retrieval"] = LayerMetrics(
            layer="retrieval",
            distributions={
                "mrr": compute_distribution(per_sample["retrieval_mrr"], "mrr"),
                "recall": compute_distribution(per_sample["retrieval_recall"], "recall"),
                "precision": compute_distribution(per_sample["retrieval_precision"], "precision"),
            },
            avg_latency_ms=retrieval_result.avg_latency_ms,
        )
        operational["retrieval_avg_latency_ms"] = retrieval_result.avg_latency_ms

        # --- Layer 2: Reranking ---
        logger.info("Evaluating reranking layer...")
        rerank_bench = RerankingBenchmark(
            self.dataset,
            self.pipeline.corpus,
            chunk_doc_ids=self.pipeline.chunk_doc_ids,
        )

        def retrieve_fn(query: str, top_n: int):
            return self.pipeline.retrieval_service.retrieve(
                query=query,
                mode=retrieval_mode,
                top_k=top_n,
                filter_metadata=_doc_filter(query),
            )

        def rerank_fn(query: str, retrieval_result, top_k: int):
            return self.pipeline.reranking_service.rerank_only(
                query=query, retrieval_result=retrieval_result, top_k=top_k
            )

        rerank_result = rerank_bench.evaluate_pipeline(
            retrieve_fn=retrieve_fn,
            rerank_fn=rerank_fn,
            pipeline_name=f"{retrieval_mode}+rerank",
            retrieval_mode=retrieval_mode,
            reranker_name=self.parameters.reranker,
            top_k=self.parameters.rerank_top_k,
            retrieve_top_n=self.parameters.retrieve_top_n,
        )

        per_sample["rerank_mrr"] = [q.mrr for q in rerank_result.per_query]
        per_sample["rerank_latency_ms"] = [q.total_latency_ms for q in rerank_result.per_query]

        aggregate["rerank_mrr_lift"] = rerank_result.mrr_lift
        aggregate["rerank_mrr"] = rerank_result.avg_mrr
        aggregate["rerank_ndcg"] = rerank_result.avg_ndcg_at_k
        aggregate["rerank_ndcg_lift"] = rerank_result.ndcg_lift
        aggregate["top1_change_rate"] = rerank_result.top1_change_rate

        layer_metrics["reranking"] = LayerMetrics(
            layer="reranking",
            distributions={
                "mrr": compute_distribution(per_sample["rerank_mrr"], "mrr"),
                "mrr_lift": compute_distribution(
                    [q.mrr for q in rerank_result.per_query], "mrr_lift"
                ),
            },
            avg_latency_ms=rerank_result.avg_total_latency_ms,
        )
        operational["rerank_avg_latency_ms"] = rerank_result.avg_total_latency_ms

        # --- Layer 3: Context Assembly ---
        logger.info("Evaluating context assembly layer...")
        context_bench = ContextBenchmark(
            self.dataset,
            self.pipeline.corpus,
            chunk_doc_ids=self.pipeline.chunk_doc_ids,
        )

        def chunks_provider(query: str):
            rr = self.pipeline.reranking_service.retrieve_and_rerank(
                query=query,
                retrieval_mode=retrieval_mode,
                top_k=10,
                filter_metadata=_doc_filter(query),
            )
            return rr.chunks

        def assemble_fn(query: str, chunks):
            return self.pipeline.context_service.assemble(query, chunks)

        context_result = context_bench.evaluate_strategy(
            assemble_fn,
            chunks_provider,
            strategy_name=self.parameters.context_strategy,
            max_tokens=self.parameters.context_max_tokens,
        )

        per_sample["context_precision"] = [q.context_precision for q in context_result.per_query]
        per_sample["context_recall"] = [q.context_recall for q in context_result.per_query]
        per_sample["context_latency_ms"] = [q.latency_ms for q in context_result.per_query]

        aggregate["context_precision"] = context_result.avg_context_precision
        aggregate["context_recall"] = context_result.avg_context_recall

        layer_metrics["context"] = LayerMetrics(
            layer="context",
            distributions={
                "precision": compute_distribution(per_sample["context_precision"], "precision"),
                "recall": compute_distribution(per_sample["context_recall"], "recall"),
            },
            avg_latency_ms=context_result.avg_latency_ms,
        )
        operational["context_avg_latency_ms"] = context_result.avg_latency_ms

        # --- Layer 4: Generation + Faithfulness ---
        logger.info("Evaluating generation layer...")
        gen_bench = GenerationBenchmark(
            self.pipeline.generation_service,
            self.pipeline.faithfulness_evaluator,
        )

        def context_fn(query: str) -> AssembledContext:
            rr = self.pipeline.reranking_service.retrieve_and_rerank(
                query=query,
                retrieval_mode=retrieval_mode,
                top_k=self.parameters.rerank_top_k,
                filter_metadata=_doc_filter(query),
            )
            return self.pipeline.context_service.assemble_from_rerank(rr)

        gen_result = gen_bench.run(self.dataset, context_fn)

        per_sample["faithfulness"] = [q.faithfulness for q in gen_result.per_query]
        per_sample["citation_precision"] = [q.citation_precision for q in gen_result.per_query]
        per_sample["hallucination_rate"] = [q.hallucination_rate for q in gen_result.per_query]
        per_sample["answer_relevancy"] = [q.answer_relevancy for q in gen_result.per_query]
        per_sample["generation_latency_ms"] = [q.generation_latency_ms for q in gen_result.per_query]

        aggregate["faithfulness"] = gen_result.avg_faithfulness
        aggregate["citation_precision"] = gen_result.avg_citation_precision
        aggregate["hallucination_rate"] = gen_result.avg_hallucination_rate
        aggregate["answer_relevancy"] = gen_result.avg_answer_relevancy

        layer_metrics["generation"] = LayerMetrics(
            layer="generation",
            distributions={
                "faithfulness": compute_distribution(
                    per_sample["faithfulness"], "faithfulness", pass_threshold=0.70
                ),
                "citation_precision": compute_distribution(
                    per_sample["citation_precision"], "citation_precision"
                ),
                "hallucination_rate": compute_distribution(
                    per_sample["hallucination_rate"], "hallucination_rate",
                    pass_threshold=0.30, higher_is_better=False,
                ),
            },
            avg_latency_ms=gen_result.avg_generation_latency_ms,
        )
        operational["generation_avg_latency_ms"] = gen_result.avg_generation_latency_ms

        # --- E2E latency ---
        e2e_latencies = []
        for i in range(len(self.dataset)):
            e2e = (
                per_sample.get("retrieval_latency_ms", [0])[min(i, len(per_sample.get("retrieval_latency_ms", [0])) - 1)]
                + per_sample.get("rerank_latency_ms", [0])[min(i, len(per_sample.get("rerank_latency_ms", [0])) - 1)]
                + per_sample.get("context_latency_ms", [0])[min(i, len(per_sample.get("context_latency_ms", [0])) - 1)]
                + per_sample.get("generation_latency_ms", [0])[min(i, len(per_sample.get("generation_latency_ms", [0])) - 1)]
            )
            e2e_latencies.append(e2e)

        per_sample["e2e_latency_ms"] = e2e_latencies
        e2e_dist = compute_distribution(e2e_latencies, "e2e_latency_ms")
        operational["e2e_avg_latency_ms"] = e2e_dist.mean
        operational["e2e_p50_latency_ms"] = e2e_dist.p50
        operational["e2e_p95_latency_ms"] = e2e_dist.p95
        aggregate["e2e_latency_p95_ms"] = e2e_dist.p95

        # --- Adversarial probes ---
        adversarial_report = None
        if run_adversarial:
            logger.info("Running adversarial faithfulness probes...")
            contexts = [context_fn(s.question) for s in self.dataset.samples]
            adversarial_report = self.adversarial_probe.run_batch(
                contexts, self.pipeline.generation_service
            )
            aggregate["adversarial_pass_rate"] = adversarial_report.pass_rate

        # --- Build distributions ---
        distributions = {}
        for key in [
            "retrieval_mrr", "retrieval_recall", "retrieval_precision",
            "context_precision", "context_recall",
            "faithfulness", "citation_precision", "hallucination_rate",
            "answer_relevancy", "e2e_latency_ms",
        ]:
            if key in per_sample:
                distributions[key] = compute_distribution(per_sample[key], key)

        # --- Quality gate ---
        gate_result = None
        baseline_deltas = []
        if check_quality_gate:
            baseline = None
            if compare_baseline and self.baseline_store:
                baseline = self.baseline_store.load(baseline_filename)

            gate_result = self.quality_gate.evaluate(
                aggregate, distributions, baseline, per_sample
            )
            if gate_result.delta_checks:
                baseline_deltas = gate_result.delta_checks

        duration_ms = (time.time() - start) * 1000
        operational["total_eval_duration_ms"] = duration_ms
        operational["queries_per_second"] = (
            len(self.dataset) / (duration_ms / 1000) if duration_ms > 0 else 0
        )

        report = EvalReport(
            run_id=self.parameters.run_id,
            timestamp=datetime.now(),
            parameters=self.parameters,
            layer_metrics=layer_metrics,
            aggregate_metrics=aggregate,
            distributions=distributions,
            per_sample_metrics=per_sample,
            quality_gate=gate_result,
            adversarial=adversarial_report,
            baseline_deltas=baseline_deltas,
            operational=operational,
            duration_ms=duration_ms,
        )

        logger.info(f"Evaluation complete in {duration_ms:.0f}ms")
        return report

    def save_baseline(
        self,
        report: EvalReport,
        filename: str = "latest.json",
    ) -> None:
        """Save report as new baseline."""
        if self.baseline_store:
            self.baseline_store.save(report.to_baseline(), filename)
            logger.info(f"Baseline saved to {filename}")
