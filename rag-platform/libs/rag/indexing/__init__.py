"""Indexing module for the RAG pipeline.

This module handles the CHUNKED → EMBEDDED → INDEXED lifecycle transitions.
It provides:
- Vector store abstraction (protocol) for swappable backends
- ChromaDB implementation for local development
- IndexingService that orchestrates embedding + vector insertion
- Chunk repository integration for dual storage (Postgres + vector store)

Architecture:
    ChunkingService produces Chunk objects
        → IndexingService embeds them (via Embedder)
        → Persists chunks to Postgres (system of record)
        → Inserts vectors into ChromaDB (search index)
        → Updates lifecycle state to INDEXED

Quick Start:
    from libs.rag.indexing import IndexingService, ChromaVectorStore

    vector_store = ChromaVectorStore(persist_directory="./data/chroma")
    service = IndexingService(vector_store=vector_store)

    result = service.index_chunks(chunks)
"""

from .vector_store import VectorStore, VectorSearchResult
from .chroma_store import ChromaVectorStore
from .service import IndexingService, IndexingConfig, IndexingResult

__all__ = [
    "VectorStore",
    "VectorSearchResult",
    "ChromaVectorStore",
    "IndexingService",
    "IndexingConfig",
    "IndexingResult",
]
