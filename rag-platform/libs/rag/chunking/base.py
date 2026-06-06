"""Base chunker interface and configuration.

All chunkers must implement the BaseChunker abstract class to ensure
consistent behavior across different chunking strategies.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional
from uuid import UUID

from libs.shared.models.chunk import Chunk, ChunkMetadata, ChunkingResult


@dataclass
class ChunkerConfig:
    """Configuration for chunking behavior.
    
    OPTIMIZED DEFAULTS (based on RAGAS benchmark evaluation - June 2026):
    - chunk_size=512: Best precision (0.94) in benchmarks, balances context vs. noise
    - chunk_overlap=50: ~10% overlap provides context continuity without redundancy
    - min_chunk_size=100: Prevents fragments that lack semantic meaning
    - max_chunk_size=1024: Allows flexibility for large code blocks/tables
    
    TUNING GUIDELINES:
    - For technical docs (runbooks, API docs): Use 512 tokens, structure_aware strategy
    - For code repositories: Use 256 tokens with preserve_code_blocks=True
    - For long-form content: Use 768-1024 tokens with 10-15% overlap
    - For Q&A datasets: Smaller chunks (256-384) often work better
    
    Attributes:
        chunk_size: Target chunk size in tokens (not characters).
        chunk_overlap: Number of tokens to overlap between chunks.
        min_chunk_size: Minimum chunk size - chunks smaller than this are merged.
        max_chunk_size: Maximum chunk size - hard limit, will force split.
        separators: Ordered list of separators to try (largest semantic unit first).
        preserve_code_blocks: If True, never split inside code blocks.
        preserve_lists: If True, keep numbered/bulleted lists atomic.
        include_section_headers: If True, prepend section header to each chunk.
        adaptive_overlap: If True, adjust overlap based on semantic similarity (experimental).
    """
    chunk_size: int = 512
    chunk_overlap: int = 50
    min_chunk_size: int = 100
    max_chunk_size: int = 1024
    
    separators: List[str] = field(default_factory=lambda: [
        "\n# ",       # H1 headers (document-level boundary)
        "\n## ",      # H2 headers (strongest section boundary)
        "\n### ",     # H3 headers
        "\n#### ",    # H4 headers
        "\n---",      # Horizontal rules (often separate sections)
        "\n\n",       # Paragraphs
        "\n```",      # Code block boundaries
        "\n- ",       # Bullet lists
        "\n* ",       # Bullet lists (alt)
        "\n1. ",      # Numbered lists
        "\n",         # Line breaks
        ". ",         # Sentences
        "; ",         # Semicolons (often separate clauses)
        ", ",         # Commas (clause boundaries)
        " ",          # Words (last resort)
    ])
    
    preserve_code_blocks: bool = True
    preserve_lists: bool = True
    include_section_headers: bool = True
    adaptive_overlap: bool = False
    
    def __post_init__(self) -> None:
        """Validate configuration after initialization."""
        if self.chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        if self.chunk_overlap < 0:
            raise ValueError("chunk_overlap cannot be negative")
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("chunk_overlap must be less than chunk_size")
        if self.min_chunk_size < 0:
            raise ValueError("min_chunk_size cannot be negative")
        if self.max_chunk_size < self.chunk_size:
            raise ValueError("max_chunk_size must be >= chunk_size")


class BaseChunker(ABC):
    """Abstract base class for all chunkers.
    
    Subclasses must implement the `chunk()` method which takes document
    text and returns a list of Chunk objects.
    
    The base class provides:
    - Configuration management
    - Common validation
    - Result packaging via `_create_result()`
    """
    
    def __init__(self, config: Optional[ChunkerConfig] = None) -> None:
        """Initialize chunker with configuration.
        
        Args:
            config: Chunking configuration. Uses defaults if not provided.
        """
        self.config = config or ChunkerConfig()
    
    @property
    @abstractmethod
    def strategy_name(self) -> str:
        """Return the name of this chunking strategy."""
        ...
    
    @abstractmethod
    def chunk(
        self,
        text: str,
        document_id: UUID,
        version_id: UUID,
        base_metadata: ChunkMetadata,
    ) -> ChunkingResult:
        """Split text into chunks.
        
        Args:
            text: The full document text to chunk.
            document_id: UUID of the parent document.
            version_id: UUID of the document version.
            base_metadata: Metadata to attach to each chunk (can be extended per-chunk).
        
        Returns:
            ChunkingResult containing all chunks and statistics.
        
        Raises:
            ValueError: If text is empty or invalid.
        """
        ...
    
    def _validate_input(self, text: str) -> None:
        """Validate input text before chunking.
        
        Args:
            text: Text to validate.
        
        Raises:
            ValueError: If text is empty or None.
        """
        if not text or not text.strip():
            raise ValueError("Cannot chunk empty or whitespace-only text")
    
    def _create_result(
        self,
        document_id: UUID,
        version_id: UUID,
        chunks: List[Chunk],
    ) -> ChunkingResult:
        """Package chunks into a ChunkingResult.
        
        Args:
            document_id: Parent document ID.
            version_id: Document version ID.
            chunks: List of created chunks.
        
        Returns:
            ChunkingResult with all chunks and statistics.
        """
        return ChunkingResult.from_chunks(
            document_id=document_id,
            version_id=version_id,
            chunks=chunks,
            strategy=self.strategy_name,
            chunk_size=self.config.chunk_size,
            overlap=self.config.chunk_overlap,
        )
