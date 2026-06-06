"""Chunking service for the ingestion pipeline.

This service integrates the chunking module with the document lifecycle,
processing registered documents into chunks ready for embedding.

LIFECYCLE POSITION:
    REGISTERED → (this service) → CHUNKED

The service:
1. Retrieves document versions in REGISTERED state
2. Applies appropriate chunker based on source type
3. Persists chunks to the database
4. Updates document lifecycle state to CHUNKED
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from libs.shared.models.chunk import Chunk, ChunkMetadata, ChunkingResult
from libs.shared.models.document import CanonicalDocument, DocumentVersion
from libs.shared.models.lifecycle import IngestionSource, IngestionState

from .base import ChunkerConfig
from .factory import get_chunker
from .github_chunker import GitHubIssueChunker


@dataclass
class ChunkingServiceConfig:
    """Configuration for the chunking service.
    
    OPTIMIZED DEFAULTS (based on RAGAS benchmark evaluation):
    - chunk_size=512: Best precision (0.94) in benchmarks
    - chunk_overlap=25: Sufficient context, no benefit from higher values
    - min_chunk_size=100: Prevents semantic fragments
    - max_chunk_size=768: Flexibility with bounded context usage
    """
    chunk_size: int = 512
    chunk_overlap: int = 25
    min_chunk_size: int = 100
    max_chunk_size: int = 768
    preserve_code_blocks: bool = True
    preserve_lists: bool = True
    include_section_headers: bool = True


@dataclass
class ChunkingJobResult:
    """Result of processing a single document for chunking."""
    document_id: UUID
    version_id: UUID
    success: bool
    chunks_created: int = 0
    total_tokens: int = 0
    error_message: Optional[str] = None
    
    @classmethod
    def success_result(
        cls,
        document_id: UUID,
        version_id: UUID,
        chunks_created: int,
        total_tokens: int,
    ) -> "ChunkingJobResult":
        return cls(
            document_id=document_id,
            version_id=version_id,
            success=True,
            chunks_created=chunks_created,
            total_tokens=total_tokens,
        )
    
    @classmethod
    def failure_result(
        cls,
        document_id: UUID,
        version_id: UUID,
        error_message: str,
    ) -> "ChunkingJobResult":
        return cls(
            document_id=document_id,
            version_id=version_id,
            success=False,
            error_message=error_message,
        )


class ChunkingService:
    """Service for chunking documents in the ingestion pipeline.
    
    This service acts as a bridge between the ingestion pipeline and the
    chunking module. It handles:
    - Retrieving document content from versions
    - Selecting appropriate chunker based on source type
    - Creating chunks with proper metadata
    - Updating lifecycle state
    
    Usage:
        service = ChunkingService(config)
        result = service.chunk_document(document, version)
        if result.success:
            # persist chunks to database
            pass
    """
    
    def __init__(self, config: Optional[ChunkingServiceConfig] = None) -> None:
        self.config = config or ChunkingServiceConfig()
        self._chunker_config = ChunkerConfig(
            chunk_size=self.config.chunk_size,
            chunk_overlap=self.config.chunk_overlap,
            min_chunk_size=self.config.min_chunk_size,
            max_chunk_size=self.config.max_chunk_size,
            preserve_code_blocks=self.config.preserve_code_blocks,
            preserve_lists=self.config.preserve_lists,
            include_section_headers=self.config.include_section_headers,
        )
    
    def chunk_document(
        self,
        document: CanonicalDocument,
        version: DocumentVersion,
    ) -> tuple[ChunkingJobResult, List[Chunk]]:
        """Chunk a document version.
        
        Args:
            document: The canonical document.
            version: The document version containing the body text.
        
        Returns:
            Tuple of (result, chunks).
            If success, chunks list contains the created chunks.
            If failure, chunks list is empty.
        """
        if not version.body_text:
            return (
                ChunkingJobResult.failure_result(
                    document.document_id,
                    version.version_id,
                    "Document version has no body_text to chunk",
                ),
                [],
            )
        
        try:
            source_type = document.metadata.source_type
            
            base_metadata = self._create_base_metadata(document)
            
            chunker = get_chunker(source_type, self._chunker_config)
            
            if (
                source_type == IngestionSource.GITHUB_ISSUE
                and document.title
                and isinstance(chunker, GitHubIssueChunker)
            ):
                result = chunker.chunk_issue_with_title(
                    title=document.title,
                    body=version.body_text,
                    document_id=document.document_id,
                    version_id=version.version_id,
                    base_metadata=base_metadata,
                )
            else:
                result = chunker.chunk(
                    text=version.body_text,
                    document_id=document.document_id,
                    version_id=version.version_id,
                    base_metadata=base_metadata,
                )
            
            return (
                ChunkingJobResult.success_result(
                    document_id=document.document_id,
                    version_id=version.version_id,
                    chunks_created=result.total_chunks,
                    total_tokens=result.total_tokens,
                ),
                result.chunks,
            )
            
        except ValueError as exc:
            return (
                ChunkingJobResult.failure_result(
                    document.document_id,
                    version.version_id,
                    f"Validation error during chunking: {exc}",
                ),
                [],
            )
        except Exception as exc:
            return (
                ChunkingJobResult.failure_result(
                    document.document_id,
                    version.version_id,
                    f"Unexpected error during chunking: {exc}",
                ),
                [],
            )
    
    def _create_base_metadata(self, document: CanonicalDocument) -> ChunkMetadata:
        """Create base chunk metadata from document metadata."""
        doc_meta = document.metadata
        return ChunkMetadata(
            source_type=doc_meta.source_type,
            source_uri=doc_meta.source_uri,
            tenant_id=doc_meta.tenant_id,
            tags=doc_meta.tags or [],
            labels=doc_meta.labels or [],
            service=doc_meta.service,
            component=doc_meta.component,
            extra=doc_meta.extra or {},
        )


def chunk_registered_document(
    document: CanonicalDocument,
    version: DocumentVersion,
    config: Optional[ChunkingServiceConfig] = None,
) -> tuple[ChunkingJobResult, List[Chunk]]:
    """Convenience function to chunk a registered document.
    
    This is the main entry point for the ingestion pipeline to call
    when transitioning documents from REGISTERED to CHUNKED state.
    
    Args:
        document: Document in REGISTERED state.
        version: Active version with body_text.
        config: Optional chunking configuration.
    
    Returns:
        Tuple of (job_result, chunks).
    
    Example:
        result, chunks = chunk_registered_document(doc, version)
        if result.success:
            chunk_repo.insert_chunks(chunks)
            doc_repo.update_lifecycle_state(doc.document_id, IngestionState.CHUNKED)
    """
    service = ChunkingService(config)
    return service.chunk_document(document, version)
