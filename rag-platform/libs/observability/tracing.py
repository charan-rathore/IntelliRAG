"""Distributed tracing for RAG pipeline request flow.

Extends libs/shared/logging trace context with span hierarchy,
per-layer timing, and eval score attachment (Phase 10 bridge).
"""

from __future__ import annotations

import contextvars
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from libs.shared.logging.structured import set_trace_context, clear_trace_context, log_event, get_logger

_current_span: contextvars.ContextVar[Optional["Span"]] = contextvars.ContextVar(
    "current_span", default=None
)

_traces: Dict[str, "Trace"] = {}
_MAX_TRACES = 1000


@dataclass
class SpanEvent:
    name: str
    timestamp: str
    attributes: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Span:
    """A single operation span within a trace."""

    span_id: str
    trace_id: str
    name: str
    parent_id: Optional[str] = None
    start_time: float = field(default_factory=time.monotonic)
    end_time: Optional[float] = None
    status: str = "ok"
    attributes: Dict[str, Any] = field(default_factory=dict)
    events: List[SpanEvent] = field(default_factory=list)
    eval_scores: Dict[str, float] = field(default_factory=dict)

    @property
    def duration_ms(self) -> float:
        end = self.end_time or time.monotonic()
        return (end - self.start_time) * 1000

    def set_attribute(self, key: str, value: Any) -> None:
        self.attributes[key] = value

    def add_event(self, name: str, **attributes: Any) -> None:
        self.events.append(SpanEvent(
            name=name,
            timestamp=datetime.now(timezone.utc).isoformat(),
            attributes=attributes,
        ))

    def set_eval_score(self, metric: str, value: float) -> None:
        """Attach Phase 10 eval rubric score to this span."""
        self.eval_scores[metric] = value

    def end(self, status: str = "ok") -> None:
        self.end_time = time.monotonic()
        self.status = status

    def to_dict(self) -> Dict:
        return {
            "span_id": self.span_id,
            "trace_id": self.trace_id,
            "name": self.name,
            "parent_id": self.parent_id,
            "duration_ms": round(self.duration_ms, 2),
            "status": self.status,
            "attributes": self.attributes,
            "events": [{"name": e.name, "timestamp": e.timestamp, **e.attributes} for e in self.events],
            "eval_scores": self.eval_scores,
        }


@dataclass
class Trace:
    """Complete request trace with all spans."""

    trace_id: str
    root_span_name: str
    start_time: str
    spans: List[Span] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def total_duration_ms(self) -> float:
        if not self.spans:
            return 0.0
        return max(s.duration_ms for s in self.spans)

    @property
    def status(self) -> str:
        if any(s.status == "error" for s in self.spans):
            return "error"
        return "ok"

    def to_dict(self) -> Dict:
        return {
            "trace_id": self.trace_id,
            "root_span_name": self.root_span_name,
            "start_time": self.start_time,
            "total_duration_ms": round(self.total_duration_ms, 2),
            "status": self.status,
            "spans": [s.to_dict() for s in self.spans],
            "metadata": self.metadata,
        }


class Tracer:
    """Create and manage spans with automatic trace context propagation."""

    def __init__(self, service_name: str = "rag-platform") -> None:
        self.service_name = service_name
        self._logger = get_logger(f"trace.{service_name}")

    def start_trace(self, name: str, **metadata: Any) -> Span:
        trace_id = str(uuid.uuid4())
        span = Span(
            span_id=str(uuid.uuid4()),
            trace_id=trace_id,
            name=name,
        )
        trace = Trace(
            trace_id=trace_id,
            root_span_name=name,
            start_time=datetime.now(timezone.utc).isoformat(),
            metadata=metadata,
        )
        trace.spans.append(span)
        _traces[trace_id] = trace
        self._trim_traces()

        set_trace_context(trace_id=trace_id, span_id=span.span_id, service=self.service_name)
        _current_span.set(span)

        log_event(self._logger, "trace_started", f"Trace started: {name}", {
            "trace_id": trace_id, "span_name": name,
        })
        return span

    def start_span(self, name: str, **attributes: Any) -> Span:
        parent = _current_span.get()
        if parent is None:
            return self.start_trace(name, **attributes)

        span = Span(
            span_id=str(uuid.uuid4()),
            trace_id=parent.trace_id,
            name=name,
            parent_id=parent.span_id,
        )
        span.attributes.update(attributes)

        trace = _traces.get(parent.trace_id)
        if trace:
            trace.spans.append(span)

        set_trace_context(
            trace_id=parent.trace_id,
            span_id=span.span_id,
            parent_span_id=parent.span_id,
        )
        _current_span.set(span)
        return span

    def end_span(self, span: Span, status: str = "ok") -> None:
        span.end(status)
        log_event(self._logger, "span_completed", f"Span completed: {span.name}", {
            "trace_id": span.trace_id,
            "span_id": span.span_id,
            "span_name": span.name,
            "duration_ms": round(span.duration_ms, 2),
            "status": status,
        })

        parent_id = span.parent_id
        if parent_id:
            trace = _traces.get(span.trace_id)
            if trace:
                for s in trace.spans:
                    if s.span_id == parent_id:
                        _current_span.set(s)
                        set_trace_context(
                            trace_id=s.trace_id, span_id=s.span_id,
                        )
                        return
        _current_span.set(None)

    def end_trace(self, span: Span, status: str = "ok") -> Trace:
        span.end(status)
        trace = _traces.get(span.trace_id)
        if trace:
            log_event(self._logger, "trace_completed", f"Trace completed: {span.name}", {
                "trace_id": span.trace_id,
                "duration_ms": round(trace.total_duration_ms, 2),
                "status": trace.status,
                "span_count": len(trace.spans),
            })
        clear_trace_context()
        _current_span.set(None)
        return trace  # type: ignore[return-value]

    def get_trace(self, trace_id: str) -> Optional[Trace]:
        return _traces.get(trace_id)

    def recent_traces(self, limit: int = 50) -> List[Trace]:
        traces = list(_traces.values())
        return traces[-limit:]

    def _trim_traces(self) -> None:
        if len(_traces) > _MAX_TRACES:
            oldest = list(_traces.keys())[: len(_traces) - _MAX_TRACES]
            for tid in oldest:
                del _traces[tid]


class SpanContext:
    """Context manager for automatic span lifecycle."""

    def __init__(self, tracer: Tracer, name: str, is_root: bool = False, **attributes: Any):
        self.tracer = tracer
        self.name = name
        self.is_root = is_root
        self.attributes = attributes
        self.span: Optional[Span] = None

    def __enter__(self) -> Span:
        if self.is_root:
            self.span = self.tracer.start_trace(self.name, **self.attributes)
        else:
            self.span = self.tracer.start_span(self.name, **self.attributes)
        return self.span

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if self.span is None:
            return
        status = "error" if exc_type else "ok"
        if self.is_root:
            self.tracer.end_trace(self.span, status)
        else:
            self.tracer.end_span(self.span, status)


def get_recent_traces(limit: int = 50) -> List[Trace]:
    return list(_traces.values())[-limit:]


def clear_traces() -> None:
    _traces.clear()
