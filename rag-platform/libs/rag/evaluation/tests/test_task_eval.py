"""Tests for Phase 12 task-specific evaluation."""

from __future__ import annotations

import shutil
import tempfile

from libs.rag.evaluation.models import EvaluationDataset, EvaluationSample
from libs.rag.evaluation.parameters import PipelineParameters
from libs.rag.evaluation.task_eval import (
    TaskEvaluator,
    compute_task_composite_score,
)
from libs.rag.evaluation.task_taxonomy import TaskType, resolve_task_type
from libs.rag.evaluation.thresholds import QualityGateConfig
from libs.rag.generation.config import GenerationConfig
from libs.rag.generation.ollama import MockLLMClient
from libs.rag.generation.service import GenerationService
from scripts.eval.pipeline_builder import build_eval_pipeline


def _sample_dataset() -> EvaluationDataset:
    return EvaluationDataset(
        name="task_test",
        samples=[
            EvaluationSample(
                sample_id="t1",
                question="What caused the Kubernetes pod scheduling failures?",
                ground_truth="Resource fragmentation on cluster nodes.",
                reference_context=["resource fragmentation on the cluster nodes"],
                document_id="k8s-incident",
                metadata={"route": "incident", "task_type": "incident_rca"},
            ),
            EvaluationSample(
                sample_id="t2",
                question="How should you manage the Python asyncio event loop?",
                ground_truth="Use asyncio.run() for top-level entry points.",
                reference_context=["Always use asyncio.run() for top-level entry points"],
                document_id="python-async",
                metadata={"route": "async", "task_type": "how_to"},
            ),
        ],
    )


class TestTaskTaxonomy:
    def test_resolve_explicit_task_type(self):
        sample = _sample_dataset().samples[0]
        assert resolve_task_type(sample) == TaskType.INCIDENT_RCA

    def test_infer_incident_resolution(self):
        sample = EvaluationSample(
            question="How were the scheduling failures resolved?",
            ground_truth="Implemented quotas.",
            reference_context=["resource quotas"],
            document_id="k8s-incident",
            metadata={"route": "incident"},
        )
        assert resolve_task_type(sample) == TaskType.INCIDENT_RESOLUTION


class TestDatasetHelpers:
    def test_group_by_task_type(self):
        dataset = _sample_dataset().with_task_types()
        groups = dataset.group_by("task_type")
        assert "incident_rca" in groups
        assert "how_to" in groups
        assert len(groups["how_to"]) == 1


class TestCompositeScore:
    def test_composite_score_range(self):
        score = compute_task_composite_score({
            "retrieval_mrr": 1.0,
            "faithfulness": 0.8,
            "answer_relevancy": 0.5,
        })
        assert 0.0 < score <= 1.0


class TestTaskEvaluator:
    def test_task_eval_runs(self):
        tmpdir = tempfile.mkdtemp(prefix="task-eval-test-")
        try:
            pipeline = build_eval_pipeline(tmpdir)
            pipeline.generation_service = GenerationService(
                config=GenerationConfig.for_ollama(model="mock"),
                llm_client=MockLLMClient(),
            )
            params = PipelineParameters(
                run_id="test",
                timestamp="2026-07-11",
                dataset_name="task_test",
                dataset_version="1.0",
                num_samples=2,
            )
            report = TaskEvaluator().evaluate(
                _sample_dataset(),
                pipeline,
                params,
                quality_gate_config=QualityGateConfig.lenient(),
                run_adversarial=False,
            )
            assert len(report.task_results) == 2
            assert all(r.num_samples == 1 for r in report.task_results)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)
