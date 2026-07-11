"""Tests for Phase 12 SOTA baseline comparison."""

from __future__ import annotations

from libs.rag.evaluation.sota_comparison import SOTA_BASELINES, SOTAConfig
from libs.rag.evaluation.task_eval import compute_task_composite_score


class TestSOTAConfig:
    def test_baseline_configs_exist(self):
        names = {c.name for c in SOTA_BASELINES}
        assert "naive_dense" in names
        assert "bm25_only" in names
        assert "hybrid_no_rerank" in names
        assert "intellirag" in names

    def test_production_config_flagged(self):
        prod = [c for c in SOTA_BASELINES if c.is_production]
        assert len(prod) == 1
        assert prod[0].name == "intellirag"

    def test_pipeline_config_build(self):
        cfg = SOTAConfig(
            name="test",
            description="test",
            retrieval_mode="dense",
            reranker_type="pass_through",
        )
        pipeline_cfg = cfg.to_pipeline_config("/tmp/test")
        assert pipeline_cfg.default_retrieval_mode == "dense"
        assert pipeline_cfg.reranker_type == "pass_through"


class TestCompositeRanking:
    def test_higher_metrics_win(self):
        good = compute_task_composite_score({
            "retrieval_mrr": 1.0,
            "faithfulness": 0.9,
            "answer_relevancy": 0.8,
            "context_precision": 0.7,
        })
        bad = compute_task_composite_score({
            "retrieval_mrr": 0.5,
            "faithfulness": 0.3,
            "answer_relevancy": 0.1,
            "context_precision": 0.2,
        })
        assert good > bad
