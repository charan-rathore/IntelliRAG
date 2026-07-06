"""Tests for the unified evaluation platform."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from libs.rag.evaluation.adversarial import AdversarialProbe, CanaryConfig
from libs.rag.evaluation.baseline import BaselineMetrics, BaselineStore
from libs.rag.evaluation.failure_feed import FailureFeed, FailureRecord
from libs.rag.evaluation.metrics import compute_distribution
from libs.rag.evaluation.models import EvaluationDataset, EvaluationSample
from libs.rag.evaluation.parameters import PipelineParameters
from libs.rag.evaluation.quality_gate import GateVerdict, QualityGate
from libs.rag.evaluation.thresholds import QualityGateConfig
from libs.rag.generation.ollama import MockLLMClient
from libs.rag.generation.service import GenerationService


class TestDistributionMetrics:
    def test_compute_distribution(self):
        values = [0.8, 0.9, 0.7, 0.85, 0.95, 0.6, 0.75, 0.88, 0.92, 0.5]
        dist = compute_distribution(values, "faithfulness", pass_threshold=0.70)
        assert dist.count == 10
        assert dist.mean > 0.7
        assert dist.p10 <= dist.p50 <= dist.p90
        assert dist.pass_rate > 0.5

    def test_empty_distribution(self):
        dist = compute_distribution([], "empty")
        assert dist.count == 0
        assert dist.mean == 0.0


class TestQualityGate:
    def test_pass_with_good_metrics(self):
        gate = QualityGate(QualityGateConfig.lenient())
        result = gate.evaluate({
            "faithfulness": 0.80,
            "hallucination_rate": 0.10,
            "retrieval_mrr": 0.60,
        })
        assert result.verdict in (GateVerdict.PASS, GateVerdict.WARNING)

    def test_fail_with_bad_faithfulness(self):
        gate = QualityGate(QualityGateConfig())
        result = gate.evaluate({
            "faithfulness": 0.20,
            "hallucination_rate": 0.80,
        })
        assert result.verdict == GateVerdict.FAIL
        assert len(result.failures) > 0

    def test_p10_tail_detection(self):
        gate = QualityGate(QualityGateConfig())
        from libs.rag.evaluation.metrics import DistributionStats

        distributions = {
            "faithfulness": DistributionStats(
                name="faithfulness", count=10, mean=0.85,
                min=0.1, max=0.95, p10=0.15, p50=0.88,
                p90=0.95, p95=0.95, std=0.2,
            ),
        }
        result = gate.evaluate(
            {"faithfulness": 0.85},
            distributions=distributions,
        )
        assert any("P10" in w for w in result.warnings)


class TestBaseline:
    def test_save_and_load(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            store = BaselineStore(tmpdir)
            baseline = BaselineMetrics(
                name="test",
                version="1.0",
                timestamp="2026-07-06",
                metrics={"faithfulness": 0.85, "retrieval_mrr": 0.70},
            )
            store.save(baseline, "test.json")
            loaded = store.load("test.json")
            assert loaded.metrics["faithfulness"] == 0.85

    def test_delta_comparison(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            store = BaselineStore(tmpdir)
            baseline = BaselineMetrics(
                name="test", version="1.0", timestamp="2026-07-06",
                metrics={"faithfulness": 0.85},
            )
            deltas = store.compare({"faithfulness": 0.75}, baseline)
            assert len(deltas) == 1
            assert abs(deltas[0].delta - (-0.10)) < 0.001
            assert deltas[0].direction == "degraded"


class TestAdversarial:
    def test_canary_detection(self):
        probe = AdversarialProbe()
        detected, keywords = probe.detect_canary_usage(
            "The root cause was a DNS misconfiguration in CoreDNS."
        )
        assert detected
        assert len(keywords) > 0

    def test_clean_answer_passes(self):
        probe = AdversarialProbe()
        detected, _ = probe.detect_canary_usage(
            "Resource fragmentation caused pod scheduling failures."
        )
        assert not detected


class TestFailureFeed:
    def test_record_and_promote(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            feed_path = Path(tmpdir) / "failures.json"
            dataset_path = Path(tmpdir) / "golden.json"

            feed = FailureFeed(feed_path)
            feed.record(FailureRecord(
                question="What caused the outage?",
                expected_answer="Resource fragmentation",
                actual_answer="DNS misconfiguration",
                failure_type="hallucination",
                failure_metric="faithfulness",
                failure_score=0.2,
                reference_context=["resource fragmentation"],
            ))

            dataset = EvaluationDataset(
                name="golden", samples=[], version="1.0"
            )
            dataset.to_json(dataset_path)

            promoted = feed.promote_to_dataset(dataset_path)
            assert promoted == 1

            updated = EvaluationDataset.from_json(dataset_path)
            assert len(updated.samples) == 1
            assert updated.samples[0].metadata["source"] == "failure_feed"


class TestGoldenDataset:
    def test_golden_dataset_loads(self):
        path = Path("data/eval/golden_dataset.json")
        if not path.exists():
            return
        dataset = EvaluationDataset.from_json(path)
        assert len(dataset.samples) >= 5
        for sample in dataset.samples:
            assert sample.question
            assert sample.ground_truth
            assert sample.reference_context


class TestPlatformIntegration:
    def test_full_evaluation_run(self):
        from libs.rag.evaluation.platform import EvaluationPlatform
        from libs.rag.generation.config import GenerationConfig
        from scripts.eval.pipeline_builder import build_eval_pipeline

        with tempfile.TemporaryDirectory() as tmpdir:
            pipeline = build_eval_pipeline(tmpdir)
            pipeline.generation_service = GenerationService(
                llm_client=MockLLMClient()
            )

            dataset = EvaluationDataset(
                name="integration-test",
                samples=[
                    EvaluationSample(
                        question="What caused the Kubernetes pod scheduling failures?",
                        ground_truth="Resource fragmentation on cluster nodes.",
                        reference_context=["resource fragmentation"],
                        document_id="k8s-incident",
                    ),
                ],
            )

            params = PipelineParameters(
                run_id="test-run",
                timestamp="2026-07-06",
                dataset_name=dataset.name,
                dataset_version="1.0",
                num_samples=1,
            )

            platform = EvaluationPlatform(
                dataset=dataset,
                pipeline=pipeline,
                parameters=params,
                quality_gate_config=QualityGateConfig.lenient(),
            )

            report = platform.run(
                run_adversarial=True,
                check_quality_gate=True,
                compare_baseline=False,
            )

            assert report.aggregate_metrics.get("faithfulness") is not None
            assert report.aggregate_metrics.get("retrieval_mrr") is not None
            assert report.adversarial is not None
            assert report.duration_ms > 0
            assert "retrieval" in report.layer_metrics

            summary = report.to_summary()
            assert "RAG EVALUATION PLATFORM REPORT" in summary

            report_dict = report.to_dict()
            assert report_dict["aggregate_metrics"]
