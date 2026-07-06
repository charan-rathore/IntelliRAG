"""Context assembly layer for the RAG platform."""

from .config import AssemblyStrategy, ContextAssemblyConfig
from .models import AssembledContext, AssemblyStats, ContextChunk
from .deduplication import deduplicate_by_similarity, deduplicate_exact, jaccard_similarity
from .selection import maximal_marginal_relevance, select_top_k
from .budget import pack_by_budget
from .compression import compress_extractive
from .service import ContextAssemblyService

__all__ = [
    "AssemblyStrategy",
    "ContextAssemblyConfig",
    "AssembledContext",
    "AssemblyStats",
    "ContextChunk",
    "ContextAssemblyService",
    "deduplicate_by_similarity",
    "deduplicate_exact",
    "jaccard_similarity",
    "maximal_marginal_relevance",
    "select_top_k",
    "pack_by_budget",
    "compress_extractive",
]
