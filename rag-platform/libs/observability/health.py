"""Health check aggregation for platform components."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Callable, Dict, List, Optional


class HealthStatus(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"


@dataclass
class ComponentHealth:
    name: str
    status: HealthStatus
    message: str = ""
    latency_ms: float = 0.0
    details: Dict = field(default_factory=dict)
    checked_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict:
        return {
            "name": self.name,
            "status": self.status.value,
            "message": self.message,
            "latency_ms": round(self.latency_ms, 2),
            "details": self.details,
            "checked_at": self.checked_at,
        }


@dataclass
class SystemHealth:
    status: HealthStatus
    components: List[ComponentHealth]
    uptime_seconds: float = 0.0
    checked_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict:
        return {
            "status": self.status.value,
            "uptime_seconds": round(self.uptime_seconds, 1),
            "checked_at": self.checked_at,
            "components": [c.to_dict() for c in self.components],
        }


class HealthChecker:
    """Run health checks against registered components."""

    def __init__(self) -> None:
        self._checks: Dict[str, Callable[[], ComponentHealth]] = {}
        self._start_time = time.monotonic()

    def register(self, name: str, check_fn: Callable[[], ComponentHealth]) -> None:
        self._checks[name] = check_fn

    def check_all(self) -> SystemHealth:
        components = []
        overall = HealthStatus.HEALTHY

        for name, fn in self._checks.items():
            start = time.monotonic()
            try:
                result = fn()
                result.latency_ms = (time.monotonic() - start) * 1000
            except Exception as e:
                result = ComponentHealth(
                    name=name,
                    status=HealthStatus.UNHEALTHY,
                    message=str(e),
                    latency_ms=(time.monotonic() - start) * 1000,
                )

            components.append(result)
            if result.status == HealthStatus.UNHEALTHY:
                overall = HealthStatus.UNHEALTHY
            elif result.status == HealthStatus.DEGRADED and overall == HealthStatus.HEALTHY:
                overall = HealthStatus.DEGRADED

        return SystemHealth(
            status=overall,
            components=components,
            uptime_seconds=time.monotonic() - self._start_time,
        )

    @staticmethod
    def check_ollama(base_url: str = "http://localhost:11434") -> ComponentHealth:
        try:
            import httpx
            start = time.monotonic()
            resp = httpx.get(f"{base_url}/api/tags", timeout=5.0)
            latency = (time.monotonic() - start) * 1000
            if resp.status_code == 200:
                models = [m.get("name", "") for m in resp.json().get("models", [])]
                return ComponentHealth(
                    name="ollama",
                    status=HealthStatus.HEALTHY,
                    message=f"{len(models)} models available",
                    latency_ms=latency,
                    details={"models": models[:5]},
                )
            return ComponentHealth(
                name="ollama", status=HealthStatus.DEGRADED,
                message=f"HTTP {resp.status_code}", latency_ms=latency,
            )
        except Exception as e:
            return ComponentHealth(
                name="ollama", status=HealthStatus.DEGRADED,
                message=f"Not reachable: {e}",
            )

    @staticmethod
    def check_metrics_registry(registry) -> ComponentHealth:
        samples = registry.all_samples()
        return ComponentHealth(
            name="metrics",
            status=HealthStatus.HEALTHY,
            message=f"{len(samples)} metric samples",
            details={"sample_count": len(samples)},
        )
