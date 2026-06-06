"""Chunk schema models for the RAG pipeline.

Chunks are the retrieval units in the RAG system. Each chunk:
- Links to a parent document and version
- Contains a portion of the document text
- Has metadata for filtering and traceability
- Tracks token count for prompt assembly budgeting
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4, uuid5

from pydantic import BaseModel, Field, field_validator

from libs.shared.models.lifecycle import IngestionSource


NAMESPACE_CHUNK = UUID("c4a8e2b1-9d3f-4e5a-8b7c-1f2e3d4c5b6a")


def make_chunk_id(document_id: UUID, chunk_index: int, chunk_hash: str) -> UUID:
    """Create a stable chunk ID from natural keys.
    
    Using document_id + chunk_index + hash ensures:
    - Same content at same position = same ID (idempotent)
    - Content change = new ID (triggers re-embedding)
    """
    key = f"{document_id}:{chunk_index}:{chunk_hash}"
    return uuid5(NAMESPACE_CHUNK, key)


def compute_chunk_hash(text: str) -> str:
    """Compute SHA-256 hash of chunk text for deduplication."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class ChunkMetadata(BaseModel):
    """Metadata attached to each chunk for filtering and traceability.
    
    This metadata is stored both in Postgres (for joins) and in the
    vector store payload (for filtered search).
    """
    source_type: IngestionSource
    source_uri: Optional[str] = None
    tenant_id: Optional[str] = None
    
    section_header: Optional[str] = None
    has_code_block: bool = False
    is_summary_chunk: bool = False
    
    tags: List[str] = Field(default_factory=list)
    labels: List[str] = Field(default_factory=list)
    service: Optional[str] = None
    component: Optional[str] = None
    
    extra: Dict[str, Any] = Field(default_factory=dict)

    def to_vector_payload(self) -> Dict[str, Any]:
        """Convert to dictionary suitable for vector store payload."""
        return {
            "source_type": self.source_type.value,
            "source_uri": self.source_uri,
            "tenant_id": self.tenant_id,
            "section_header": self.section_header,
            "has_code_block": self.has_code_block,
            "is_summary_chunk": self.is_summary_chunk,
            "tags": self.tags,
            "labels": self.labels,
            "service": self.service,
            "component": self.component,
        }


class Chunk(BaseModel):
    """A single chunk of text from a document.
    
    Chunks are the atomic retrieval units. Each chunk should be:
    - Self-contained: understandable without surrounding context
    - Appropriately sized: small enough for precision, large enough for meaning
    - Traceable: linked back to source document and version
    """
    chunk_id: UUID
    document_id: UUID
    version_id: UUID
    
    chunk_index: int = Field(ge=0, description="Position in document (0-indexed)")
    chunk_text: str = Field(min_length=1, description="The actual chunk content")
    chunk_hash: str = Field(description="SHA-256 hash of chunk_text")
    
    token_count: int = Field(ge=0, description="Approximate token count for budgeting")
    char_count: int = Field(ge=0, description="Character count")
    
    metadata: ChunkMetadata
    
    start_char_offset: Optional[int] = Field(
        default=None, 
        description="Character offset in original document where chunk starts"
    )
    end_char_offset: Optional[int] = Field(
        default=None,
        description="Character offset in original document where chunk ends"
    )
    
    created_at: datetime = Field(default_factory=lambda: datetime.now())
    
    @field_validator("chunk_hash")
    @classmethod
    def validate_hash_format(cls, v: str) -> str:
        """Ensure hash is valid SHA-256 hex string."""
        if len(v) != 64 or not all(c in "0123456789abcdef" for c in v):
            raise ValueError("chunk_hash must be a 64-character hex string (SHA-256)")
        return v

    @classmethod
    def create(
        cls,
        document_id: UUID,
        version_id: UUID,
        chunk_index: int,
        chunk_text: str,
        token_count: int,
        metadata: ChunkMetadata,
        start_char_offset: Optional[int] = None,
        end_char_offset: Optional[int] = None,
    ) -> "Chunk":
        """Factory method to create a chunk with auto-generated ID and hash."""
        chunk_hash = compute_chunk_hash(chunk_text)
        chunk_id = make_chunk_id(document_id, chunk_index, chunk_hash)
        
        return cls(
            chunk_id=chunk_id,
            document_id=document_id,
            version_id=version_id,
            chunk_index=chunk_index,
            chunk_text=chunk_text,
            chunk_hash=chunk_hash,
            token_count=token_count,
            char_count=len(chunk_text),
            metadata=metadata,
            start_char_offset=start_char_offset,
            end_char_offset=end_char_offset,
        )


class ChunkingResult(BaseModel):
    """Result of chunking a document.
    
    Contains all chunks plus summary statistics for monitoring.
    """
    document_id: UUID
    version_id: UUID
    chunks: List[Chunk]
    
    total_chunks: int
    total_tokens: int
    total_chars: int
    
    chunking_strategy: str = Field(description="Name of the chunker used")
    chunk_size_config: int = Field(description="Target chunk size in tokens")
    overlap_config: int = Field(description="Overlap size in tokens")
    
    @classmethod
    def from_chunks(
        cls,
        document_id: UUID,
        version_id: UUID,
        chunks: List[Chunk],
        strategy: str,
        chunk_size: int,
        overlap: int,
    ) -> "ChunkingResult":
        """Create result from a list of chunks."""
        return cls(
            document_id=document_id,
            version_id=version_id,
            chunks=chunks,
            total_chunks=len(chunks),
            total_tokens=sum(c.token_count for c in chunks),
            total_chars=sum(c.char_count for c in chunks),
            chunking_strategy=strategy,
            chunk_size_config=chunk_size,
            overlap_config=overlap,
        )
