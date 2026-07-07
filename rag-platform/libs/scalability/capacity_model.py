"""Capacity modeling for Phase 12 scalability reviews."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List


@dataclass
class ScaleTier:
    name: str
    document_count: int
    avg_chunks_per_doc: int
    embedding_dimensions: int = 768
    bytes_per_float: int = 4

    @property
    def total_chunks(self) -> int:
        return self.document_count * self.avg_chunks_per_doc

    @property
    def vector_storage_mb(self) -> float:
        bytes_total = self.total_chunks * self.embedding_dimensions * self.bytes_per_float
        return bytes_total / (1024 * 1024)

    @property
    def metadata_storage_mb(self) -> float:
        # ~2KB chunk text + metadata average
        return (self.total_chunks * 2048) / (1024 * 1024)

    @property
    def total_storage_mb(self) -> float:
        return self.vector_storage_mb + self.metadata_storage_mb


@dataclass
class BottleneckReport:
    tier: str
    storage_mb: float
    estimated_index_build_minutes: float
    estimated_query_latency_p95_ms: float
    bottlenecks: List[str] = field(default_factory=list)
    mitigations: List[str] = field(default_factory=list)


class CapacityModel:
    """Local-first capacity estimates for ChromaDB + Ollama stack."""

    TIERS = [
        ScaleTier("10K", 10_000, 8),
        ScaleTier("100K", 100_000, 8),
        ScaleTier("1M", 1_000_000, 8),
        ScaleTier("10M", 10_000_000, 8),
    ]

    def analyze_tier(self, tier: ScaleTier) -> BottleneckReport:
        storage = tier.total_storage_mb
        bottlenecks: List[str] = []
        mitigations: List[str] = []

        if tier.document_count >= 100_000:
            bottlenecks.append("Chroma SQLite single-node index size exceeds comfortable local limits")
            mitigations.append("Shard collections by tenant or document type")

        if tier.document_count >= 1_000_000:
            bottlenecks.append("In-memory BM25 corpus rebuild becomes expensive")
            mitigations.append("Move keyword index to persistent inverted index (Tantivy/Elasticsearch)")

        if tier.document_count >= 10_000_000:
            bottlenecks.append("Single-process Ollama embedding throughput cannot keep up with ingestion")
            mitigations.append("Batch embedding workers with queue backpressure and int8 quantization")

        if storage > 500:
            bottlenecks.append(f"Vector storage ~{storage:.0f}MB stresses local disk budget")
            mitigations.append("Use 512d or binary embeddings; prune stale document versions")

        build_minutes = (tier.total_chunks / 1000) * 0.5
        query_p95 = 5 + (tier.document_count / 10_000) * 2

        return BottleneckReport(
            tier=tier.name,
            storage_mb=storage,
            estimated_index_build_minutes=build_minutes,
            estimated_query_latency_p95_ms=query_p95,
            bottlenecks=bottlenecks,
            mitigations=mitigations,
        )

    def full_report(self) -> Dict[str, dict]:
        return {
            tier.name: self.analyze_tier(tier).__dict__
            for tier in self.TIERS
        }
