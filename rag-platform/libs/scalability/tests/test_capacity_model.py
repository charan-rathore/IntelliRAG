"""Tests for Phase 12 capacity model."""

from __future__ import annotations

from libs.scalability import CapacityModel


def test_capacity_model_all_tiers():
    model = CapacityModel()
    report = model.full_report()
    assert set(report.keys()) == {"10K", "100K", "1M", "10M"}
    assert report["10K"]["storage_mb"] < report["10M"]["storage_mb"]
