"""Chunking module for the RAG pipeline.

This module provides various text chunking strategies optimized for
different document types in the knowledge intelligence platform.

Quick Start:
    >>> from libs.rag.chunking import get_chunker
    >>> from libs.shared.models.lifecycle import IngestionSource
    >>> 
    >>> chunker = get_chunker(IngestionSource.GITHUB_ISSUE)
    >>> result = chunker.chunk(text, document_id, version_id, metadata)
    >>> print(f"Created {result.total_chunks} chunks")

Available Chunkers:
    - RecursiveChunker: General-purpose recursive splitting (baseline)
    - StructureAwareChunker: Markdown-aware, preserves headers/code/lists
    - GitHubIssueChunker: Specialized for GitHub issues and comments

Configuration:
    >>> from libs.rag.chunking import ChunkerConfig
    >>> config = ChunkerConfig(chunk_size=512, chunk_overlap=50)
    >>> chunker = get_chunker(IngestionSource.MARKDOWN_DOC, config)
"""

from .base import BaseChunker, ChunkerConfig
from .factory import (
    ChunkerFactory,
    get_chunker,
    get_chunker_for_strategy,
    register_chunker,
)
from .github_chunker import GitHubComment, GitHubIssueChunker
from .recursive import RecursiveChunker
from .semantic import SemanticChunker, SemanticChunkerConfig
from .service import (
    ChunkingJobResult,
    ChunkingService,
    ChunkingServiceConfig,
    chunk_registered_document,
)
from .structure_aware import StructureAwareChunker
from .utils import (
    estimate_token_count,
    find_code_blocks,
    normalize_whitespace,
)

__all__ = [
    "BaseChunker",
    "ChunkerConfig",
    "ChunkerFactory",
    "ChunkingJobResult",
    "ChunkingService",
    "ChunkingServiceConfig",
    "GitHubComment",
    "GitHubIssueChunker",
    "RecursiveChunker",
    "SemanticChunker",
    "SemanticChunkerConfig",
    "StructureAwareChunker",
    "chunk_registered_document",
    "estimate_token_count",
    "find_code_blocks",
    "get_chunker",
    "get_chunker_for_strategy",
    "normalize_whitespace",
    "register_chunker",
]
