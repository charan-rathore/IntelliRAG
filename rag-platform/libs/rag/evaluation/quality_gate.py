"""Quality gate evaluation with absolute floors and baseline delta checks."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional

from .baseline import BaselineMetrics, BaselineStore, DeltaResult
from .metrics import DistributionStats
from .thresholds import MetricThreshold, QualityGateConfig, ThresholdLevel


class GateVerdict(str, Enum):
    PASS = "pass"
    WARNING = "warning"
    FAIL = "fail"


@dataclass
class GateCheck:
    """Result of a single metric gate check."""

    metric: str
    value: float
    threshold: MetricThreshold
    level: ThresholdLevel
    verdict: GateVerdict
    message: str
    p10: Optional[float] = None

    def to_dict(self) -> dict:
        return {
            "metric": self.metric,
            "value": round(self.value, 4),
            "level": self.level.value,
            "verdict": self.verdict.value,
            "message": self.message,
            "p10": round(self.p10, 4) if self.p10 is not None else None,
        }


@dataclass
class QualityGateResult:
    """Complete quality gate evaluation."""

    verdict: GateVerdict
    checks: List[GateCheck] = field(default_factory=list)
    delta_checks: List[DeltaResult] = field(default_factory=list)
    failures: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return self.verdict == GateVerdict.PASS

    def to_summary(self) -> str:
        lines = [
            f"Quality Gate: {self.verdict.value.upper()}",
            f"Checks: {len(self.checks)} | Failures: {len(self.failures)} | Warnings: {len(self.warnings)}",
            "-" * 60,
        ]
        for check in self.checks:
            marker = {"pass": "✓", "warning": "!", "fail": "✗"}.get(check.verdict.value, "?")
            p10_str = f" P10={check.p10:.3f}" if check.p10 is not None else ""
            lines.append(
                f"  [{marker}] {check.metric}: {check.value:.4f} "
                f"({check.level.value}){p10_str}"
            )
        if self.failures:
            lines.append("\nFailures:")
            for f in self.failures:
                lines.append(f"  - {f}")
        if self.warnings:
            lines.append("\nWarnings:")
            for w in self.warnings:
                lines.append(f"  - {w}")
        if self.delta_checks:
            lines.append("\nBaseline Deltas:")
            for d in self.delta_checks:
                sig = "*" if d.significant else ""
                lines.append(
                    f"  {d.metric}: {d.current:.4f} vs {d.baseline:.4f} "
                    f"({d.direction}{sig})"
                )
        return "\n".join(lines)


class QualityGate:
    """Evaluate metrics against thresholds and baselines."""

    def __init__(
        self,
        config: Optional[QualityGateConfig] = None,
        baseline_store: Optional[BaselineStore] = None,
    ) -> None:
        self.config = config or QualityGateConfig()
        self.baseline_store = baseline_store

    def evaluate(
        self,
        metrics: Dict[str, float],
        distributions: Optional[Dict[str, DistributionStats]] = None,
        baseline: Optional[BaselineMetrics] = None,
        per_sample: Optional[Dict[str, List[float]]] = None,
        check_deltas: bool = True,
    ) -> QualityGateResult:
        """Run all gate checks against current metrics."""
        checks: List[GateCheck] = []
        failures: List[str] = []
        warnings: List[str] = []

        for name, threshold in self.config.all_thresholds().items():
            value = metrics.get(name)
            if value is None:
                continue

            level = threshold.evaluate(value)
            p10 = None
            if distributions and name in distributions:
                p10 = distributions[name].p10
                if p10 is not None:
                    p10_level = threshold.evaluate(p10)
                    if p10_level == ThresholdLevel.CRITICAL:
                        level = ThresholdLevel.CRITICAL
                        warnings.append(
                            f"{name} P10={p10:.3f} below critical floor"
                        )

            if level == ThresholdLevel.CRITICAL:
                verdict = GateVerdict.FAIL
                failures.append(
                    f"{name}={value:.4f} below critical threshold "
                    f"({threshold.critical})"
                )
            elif level == ThresholdLevel.WARNING:
                verdict = GateVerdict.WARNING
                warnings.append(
                    f"{name}={value:.4f} in warning zone "
                    f"({threshold.warning}-{threshold.good})"
                )
            else:
                verdict = GateVerdict.PASS

            checks.append(
                GateCheck(
                    metric=name,
                    value=value,
                    threshold=threshold,
                    level=level,
                    verdict=verdict,
                    message=f"{name}={value:.4f} → {level.value}",
                    p10=p10,
                )
            )

        delta_checks: List[DeltaResult] = []
        if check_deltas and baseline is not None:
            delta_checks = BaselineStore(".").compare(
                metrics, baseline, per_sample, None
            )
            for delta in delta_checks:
                if delta.significant and delta.direction == "degraded":
                    warnings.append(
                        f"Significant degradation in {delta.metric}: "
                        f"{delta.current:.4f} vs baseline {delta.baseline:.4f}"
                    )

        overall = GateVerdict.PASS
        if failures:
            overall = GateVerdict.FAIL
        elif warnings:
            overall = GateVerdict.WARNING

        return QualityGateResult(
            verdict=overall,
            checks=checks,
            delta_checks=delta_checks,
            failures=failures,
            warnings=warnings,
        )
