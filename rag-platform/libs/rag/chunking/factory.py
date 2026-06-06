"""Chunker factory for selecting the right chunker based on source type.

The factory pattern allows the ingestion pipeline to request a chunker
without knowing the specific implementation details, enabling easy
extension and testing.

BENCHMARK RESULTS (RAGAS evaluation):
- RecursiveChunker achieved best F1 score (0.8485) with 512 tokens, 25 overlap
- RecursiveChunker outperformed StructureAwareChunker on precision (0.94 vs 0.82)
- Recursive strategy is now the default for most source types
"""

from __future__ import annotations

from typing import Dict, Optional, Type

from libs.shared.models.lifecycle import IngestionSource

from .base import BaseChunker, ChunkerConfig
from .github_chunker import GitHubIssueChunker
from .hybrid import HybridChunker
from .recursive import RecursiveChunker
from .semantic import SemanticChunker
from .structure_aware import StructureAwareChunker


CHUNKER_REGISTRY: Dict[IngestionSource, Type[BaseChunker]] = {
    IngestionSource.GITHUB_ISSUE: GitHubIssueChunker,
    IngestionSource.GITHUB_ISSUE_COMMENT: GitHubIssueChunker,
    IngestionSource.MARKDOWN_DOC: HybridChunker,
}

DEFAULT_CHUNKER: Type[BaseChunker] = RecursiveChunker


def get_chunker(
    source_type: IngestionSource,
    config: Optional[ChunkerConfig] = None,
) -> BaseChunker:
    """Get the appropriate chunker for a given source type.
    
    Args:
        source_type: The type of source being chunked.
        config: Optional chunker configuration. Uses defaults if not provided.
    
    Returns:
        An instance of the appropriate chunker.
    
    Examples:
        >>> chunker = get_chunker(IngestionSource.GITHUB_ISSUE)
        >>> result = chunker.chunk(text, doc_id, version_id, metadata)
    """
    chunker_class = CHUNKER_REGISTRY.get(source_type, DEFAULT_CHUNKER)
    return chunker_class(config)


def get_chunker_for_strategy(
    strategy: str,
    config: Optional[ChunkerConfig] = None,
) -> BaseChunker:
    """Get a chunker by strategy name.
    
    Useful for testing or when you want to explicitly choose a strategy
    regardless of source type.
    
    Args:
        strategy: Strategy name ("recursive", "structure_aware", "github_issue", "semantic", "hybrid").
        config: Optional chunker configuration.
    
    Returns:
        An instance of the requested chunker.
    
    Raises:
        ValueError: If strategy name is unknown.
    """
    strategy_map: Dict[str, Type[BaseChunker]] = {
        "recursive": RecursiveChunker,
        "structure_aware": StructureAwareChunker,
        "github_issue": GitHubIssueChunker,
        "semantic": SemanticChunker,
        "hybrid": HybridChunker,
    }
    
    if strategy not in strategy_map:
        available = ", ".join(strategy_map.keys())
        raise ValueError(f"Unknown strategy '{strategy}'. Available: {available}")
    
    return strategy_map[strategy](config)


def register_chunker(
    source_type: IngestionSource,
    chunker_class: Type[BaseChunker],
) -> None:
    """Register a custom chunker for a source type.
    
    This allows extending the factory with custom chunkers without
    modifying the factory code.
    
    Args:
        source_type: The source type to register for.
        chunker_class: The chunker class to use.
    
    Examples:
        >>> class MyCustomChunker(BaseChunker):
        ...     pass
        >>> register_chunker(IngestionSource.MARKDOWN_DOC, MyCustomChunker)
    """
    CHUNKER_REGISTRY[source_type] = chunker_class


class ChunkerFactory:
    """Factory class for creating and caching chunkers.
    
    Use this when you need to reuse chunkers across multiple documents
    with the same configuration, avoiding repeated instantiation.
    """
    
    def __init__(self, default_config: Optional[ChunkerConfig] = None) -> None:
        """Initialize factory with optional default configuration.
        
        Args:
            default_config: Default config to use when none is specified.
        """
        self._default_config = default_config or ChunkerConfig()
        self._cache: Dict[tuple, BaseChunker] = {}
    
    def get(
        self,
        source_type: IngestionSource,
        config: Optional[ChunkerConfig] = None,
    ) -> BaseChunker:
        """Get a chunker, using cache if available.
        
        Args:
            source_type: Source type to get chunker for.
            config: Optional config override.
        
        Returns:
            Chunker instance (may be cached).
        """
        effective_config = config or self._default_config
        
        cache_key = (source_type, id(effective_config))
        
        if cache_key not in self._cache:
            self._cache[cache_key] = get_chunker(source_type, effective_config)
        
        return self._cache[cache_key]
    
    def clear_cache(self) -> None:
        """Clear the chunker cache."""
        self._cache.clear()
