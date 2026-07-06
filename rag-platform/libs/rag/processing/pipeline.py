"""Post-ingestion processing pipeline.

Orchestrates REGISTERED -> CHUNKED -> EMBEDDED -> INDEXED -> PUBLISHED.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

import psycopg
from psycopg.rows import dict_row

from libs.connectors.sinks.postgres.chunk_repository import ChunkRepository
from libs.connectors.sinks.postgres.document_repository import PostgresDocumentRepository
from libs.rag.chunking.service import ChunkingService, ChunkingServiceConfig
from libs.rag.indexing.chroma_store import ChromaVectorStore
from libs.rag.indexing.service import IndexingConfig, IndexingResult, IndexingService
from libs.shared.models.document import (
    CanonicalDocument,
    DocumentMetadata,
    DocumentVersion,
)
from libs.shared.models.lifecycle import IngestionSource, IngestionState

logger = logging.getLogger(__name__)


@dataclass
class ProcessingResult:
    """Result of processing a registered document through the full pipeline."""

    document_id: UUID
    version_id: UUID
    success: bool
    chunks_created: int = 0
    chunks_indexed: int = 0
    lifecycle_state: str = ""
    error_message: Optional[str] = None


class ProcessingPipeline:
    """End-to-end pipeline from REGISTERED to PUBLISHED."""

    def __init__(
        self,
        dsn: str,
        chroma_persist_dir: Optional[str] = None,
        chunking_config: Optional[ChunkingServiceConfig] = None,
        indexing_config: Optional[IndexingConfig] = None,
    ) -> None:
        self.dsn = dsn
        self.chroma_persist_dir = chroma_persist_dir or os.getenv(
            "CHROMA_PERSIST_DIR", "./data/chroma"
        )
        self.chunking_service = ChunkingService(chunking_config)
        self.document_repo = PostgresDocumentRepository(dsn)
        self.chunk_repo = ChunkRepository(dsn)

        indexing_config = indexing_config or IndexingConfig()
        vector_store = ChromaVectorStore(
            collection_name=indexing_config.collection_name,
            persist_directory=self.chroma_persist_dir,
            embedding_dimensions=indexing_config.embedding_config.dimensions,
        )
        self.indexing_service = IndexingService(
            vector_store=vector_store,
            config=indexing_config,
            chunk_repository=self.chunk_repo,
        )

    def process_document(self, document_id: UUID) -> ProcessingResult:
        """Process a single document from REGISTERED to PUBLISHED."""
        with psycopg.connect(self.dsn, row_factory=dict_row) as conn:
            doc_row = self.document_repo.get_document(document_id, conn=conn)
            if doc_row is None:
                return ProcessingResult(
                    document_id=document_id,
                    version_id=UUID(int=0),
                    success=False,
                    error_message=f"Document not found: {document_id}",
                )

            version_row = self.document_repo.get_active_version(document_id, conn=conn)
            if version_row is None:
                return ProcessingResult(
                    document_id=document_id,
                    version_id=UUID(int=0),
                    success=False,
                    error_message=f"No active version for document: {document_id}",
                )

            document = self._row_to_document(doc_row)
            version = self._row_to_version(version_row)

            if document.lifecycle_state != IngestionState.REGISTERED:
                return ProcessingResult(
                    document_id=document_id,
                    version_id=version.version_id,
                    success=False,
                    error_message=(
                        f"Document not in REGISTERED state: {document.lifecycle_state.value}"
                    ),
                )

            chunk_result, chunks = self.chunking_service.chunk_document(document, version)
            if not chunk_result.success:
                return ProcessingResult(
                    document_id=document_id,
                    version_id=version.version_id,
                    success=False,
                    error_message=chunk_result.error_message,
                )

            try:
                self.chunk_repo.delete_chunks_for_version(version.version_id, conn=conn)
                inserted = self.chunk_repo.insert_chunks(chunks, conn=conn)
                self.document_repo.update_lifecycle_state(
                    document_id,
                    IngestionState.CHUNKED.value,
                    conn=conn,
                )
                conn.commit()
            except Exception as e:
                conn.rollback()
                logger.error(f"Chunk persistence failed for {document_id}: {e}", exc_info=True)
                return ProcessingResult(
                    document_id=document_id,
                    version_id=version.version_id,
                    success=False,
                    error_message=f"Chunk persistence failed: {e}",
                )

            index_result = self.indexing_service.index_document_chunks(
                chunks=chunks,
                document_id=document_id,
                version_id=version.version_id,
            )
            if not index_result.success:
                return ProcessingResult(
                    document_id=document_id,
                    version_id=version.version_id,
                    success=False,
                    chunks_created=inserted,
                    error_message=index_result.error_message,
                )

            try:
                self.document_repo.update_lifecycle_state(
                    document_id,
                    IngestionState.INDEXED.value,
                    conn=conn,
                )
                self.document_repo.update_lifecycle_state(
                    document_id,
                    IngestionState.PUBLISHED.value,
                    conn=conn,
                )
                conn.commit()
            except Exception as e:
                conn.rollback()
                return ProcessingResult(
                    document_id=document_id,
                    version_id=version.version_id,
                    success=False,
                    chunks_created=inserted,
                    chunks_indexed=index_result.chunks_indexed,
                    error_message=f"Lifecycle update failed: {e}",
                )

            return ProcessingResult(
                document_id=document_id,
                version_id=version.version_id,
                success=True,
                chunks_created=inserted,
                chunks_indexed=index_result.chunks_indexed,
                lifecycle_state=IngestionState.PUBLISHED.value,
            )

    def _row_to_document(self, row: dict) -> CanonicalDocument:
        return CanonicalDocument(
            document_id=row["document_id"],
            external_id=row["external_id"],
            title=row.get("title"),
            metadata=DocumentMetadata(
                source_type=IngestionSource(row["source_type"]),
                source_uri=row.get("source_uri"),
                tenant_id=row.get("tenant_id"),
                owners=row.get("owners"),
                tags=row.get("tags"),
                labels=row.get("labels"),
                environment=row.get("environment"),
                service=row.get("service"),
                component=row.get("component"),
                access_policy=row.get("access_policy"),
            ),
            hash_content=row["hash_content"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            ingested_at=row["ingested_at"],
            lifecycle_state=IngestionState(row["lifecycle_state"]),
        )

    def _row_to_version(self, row: dict) -> DocumentVersion:
        return DocumentVersion(
            document_id=row["document_id"],
            version_id=row["version_id"],
            version_index=row["version_index"],
            body_raw_uri=row.get("body_raw_uri"),
            body_text=row.get("body_text"),
            source_payload_uri=row.get("source_payload_uri"),
            hash_payload=row["hash_payload"],
            valid_from=row["valid_from"],
            valid_to=row.get("valid_to"),
            is_active=row["is_active"],
        )
