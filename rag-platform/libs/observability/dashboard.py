"""Operational dashboard for RAG platform visibility."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Dict, Optional

from .collector import ObservabilityCollector, ObservabilitySnapshot


@dataclass
class DashboardPanel:
    title: str
    panel_type: str
    data: Dict


class Dashboard:
    """Generate operational dashboard data and HTML."""

    def __init__(self, collector: ObservabilityCollector) -> None:
        self.collector = collector

    def build_panels(self, snapshot: Optional[ObservabilitySnapshot] = None) -> Dict:
        snap = snapshot or self.collector.snapshot()
        summary = snap.summary
        metrics = snap.metrics

        return {
            "timestamp": snap.timestamp,
            "panels": [
                {
                    "title": "Query Overview",
                    "type": "stat",
                    "data": {
                        "total_queries": summary.get("total_queries", 0),
                        "success_rate": summary.get("success_rate", 0),
                        "total_errors": summary.get("total_errors", 0),
                        "recent_traces": summary.get("recent_trace_count", 0),
                    },
                },
                {
                    "title": "Layer Latency (P50 ms)",
                    "type": "bar",
                    "data": {
                        layer: info.get("p50", 0)
                        for layer, info in summary.get("layer_latencies", {}).items()
                    },
                },
                {
                    "title": "Eval Scores (latest gauges)",
                    "type": "gauge",
                    "data": {
                        k.replace("rag_eval_", ""): v
                        for k, v in metrics.get("gauges", {}).items()
                        if "rag_eval_" in k
                    },
                },
                {
                    "title": "E2E Latency",
                    "type": "histogram",
                    "data": metrics.get("histograms", {}).get("rag_e2e_latency_ms", {}),
                },
                {
                    "title": "System Health",
                    "type": "health",
                    "data": snap.health or {},
                },
                {
                    "title": "Recent Traces",
                    "type": "traces",
                    "data": snap.traces[:10],
                },
            ],
        }

    def to_json(self) -> str:
        return json.dumps(self.build_panels(), indent=2, default=str)

    def to_html(self) -> str:
        panels = self.build_panels()
        summary = panels["panels"][0]["data"]
        latencies = panels["panels"][1]["data"]
        eval_scores = panels["panels"][2]["data"]
        health = panels["panels"][4]["data"]
        traces = panels["panels"][5]["data"]

        latency_bars = ""
        max_lat = max(latencies.values()) if latencies else 1
        for layer, ms in latencies.items():
            pct = min(100, (ms / max(max_lat, 1)) * 100)
            latency_bars += f"""
            <div class="bar-row">
              <span class="label">{layer}</span>
              <div class="bar-bg"><div class="bar-fill" style="width:{pct:.0f}%"></div></div>
              <span class="value">{ms:.1f}ms</span>
            </div>"""

        eval_rows = ""
        for metric, value in eval_scores.items():
            color = "#22c55e" if value >= 0.7 else "#eab308" if value >= 0.4 else "#ef4444"
            eval_rows += f"""
            <div class="eval-row">
              <span>{metric}</span>
              <span style="color:{color};font-weight:600">{value:.3f}</span>
            </div>"""

        trace_rows = ""
        for t in traces:
            status_color = "#22c55e" if t.get("status") == "ok" else "#ef4444"
            trace_rows += f"""
            <tr>
              <td><code>{t['trace_id'][:8]}</code></td>
              <td>{t.get('root_span_name','')}</td>
              <td>{t.get('total_duration_ms',0):.0f}ms</td>
              <td style="color:{status_color}">{t.get('status','')}</td>
              <td>{len(t.get('spans',[]))}</td>
            </tr>"""

        health_status = health.get("status", "unknown")
        health_color = {"healthy": "#22c55e", "degraded": "#eab308", "unhealthy": "#ef4444"}.get(
            health_status, "#6b7280"
        )

        return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="30">
<title>RAG Platform Dashboard</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #0f172a; color: #e2e8f0; padding: 24px; }}
  h1 {{ font-size: 1.5rem; margin-bottom: 4px; }}
  .subtitle {{ color: #94a3b8; font-size: 0.85rem; margin-bottom: 24px; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }}
  .card {{ background: #1e293b; border-radius: 8px; padding: 20px; border: 1px solid #334155; }}
  .card h2 {{ font-size: 0.9rem; color: #94a3b8; text-transform: uppercase;
              letter-spacing: 0.05em; margin-bottom: 16px; }}
  .stat {{ font-size: 2rem; font-weight: 700; color: #38bdf8; }}
  .stat-label {{ font-size: 0.8rem; color: #64748b; }}
  .stats-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }}
  .bar-row {{ display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }}
  .label {{ width: 80px; font-size: 0.8rem; color: #94a3b8; }}
  .bar-bg {{ flex: 1; height: 8px; background: #334155; border-radius: 4px; }}
  .bar-fill {{ height: 100%; background: #38bdf8; border-radius: 4px; }}
  .value {{ width: 60px; text-align: right; font-size: 0.8rem; }}
  .eval-row {{ display: flex; justify-content: space-between; padding: 6px 0;
               border-bottom: 1px solid #334155; font-size: 0.85rem; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 0.8rem; }}
  th {{ text-align: left; color: #64748b; padding: 6px 8px; border-bottom: 1px solid #334155; }}
  td {{ padding: 6px 8px; border-bottom: 1px solid #1e293b; }}
  code {{ background: #334155; padding: 2px 6px; border-radius: 3px; font-size: 0.75rem; }}
  .health-badge {{ display: inline-block; padding: 4px 12px; border-radius: 12px;
                   font-weight: 600; font-size: 0.85rem; color: {health_color};
                   border: 1px solid {health_color}; }}
  .full-width {{ grid-column: 1 / -1; }}
</style>
</head>
<body>
<h1>RAG Platform Dashboard</h1>
<p class="subtitle">Phase 11 Observability &middot; Updated {panels['timestamp']}</p>

<div class="grid">
  <div class="card">
    <h2>Query Overview</h2>
    <div class="stats-grid">
      <div><div class="stat">{summary.get('total_queries', 0)}</div><div class="stat-label">Total Queries</div></div>
      <div><div class="stat">{summary.get('success_rate', 0) * 100:.0f}%</div><div class="stat-label">Success Rate</div></div>
      <div><div class="stat">{summary.get('total_errors', 0)}</div><div class="stat-label">Errors</div></div>
      <div><div class="stat">{summary.get('recent_trace_count', 0)}</div><div class="stat-label">Recent Traces</div></div>
    </div>
  </div>

  <div class="card">
    <h2>System Health</h2>
    <div class="health-badge">{health_status.upper()}</div>
    <p style="margin-top:12px;font-size:0.8rem;color:#94a3b8">
      Uptime: {health.get('uptime_seconds', 0):.0f}s
    </p>
  </div>

  <div class="card">
    <h2>Layer Latency</h2>
    {latency_bars or '<p style="color:#64748b">No data yet</p>'}
  </div>

  <div class="card">
    <h2>Eval Scores</h2>
    {eval_rows or '<p style="color:#64748b">No eval data yet</p>'}
  </div>

  <div class="card full-width">
    <h2>Recent Traces</h2>
    <table>
      <thead><tr><th>Trace ID</th><th>Operation</th><th>Duration</th><th>Status</th><th>Spans</th></tr></thead>
      <tbody>{trace_rows or '<tr><td colspan="5" style="color:#64748b">No traces yet</td></tr>'}</tbody>
    </table>
  </div>
</div>
</body>
</html>"""
