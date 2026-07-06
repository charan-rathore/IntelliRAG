-- Migration 005: Chunks table and embedding tracking
--
-- WHY THIS TABLE EXISTS:
-- Chunks are the atomic retrieval units in the RAG pipeline. Persisting them
-- in Postgres gives us transactional lifecycle management, metadata queries,
-- and a system of record that's independent of the vector store.
--
-- The vector store (ChromaDB) is a search index, not a database. If it's
-- corrupted or needs rebuilding, we reconstruct from this table.

CREATE TABLE IF NOT EXISTS chunks (
    chunk_id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    version_id UUID NOT NULL REFERENCES document_versions(version_id) ON DELETE CASCADE,

    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    chunk_hash TEXT NOT NULL,

    token_count INTEGER NOT NULL DEFAULT 0,
    char_count INTEGER NOT NULL DEFAULT 0,

    start_char_offset INTEGER,
    end_char_offset INTEGER,

    -- Metadata for filtering (denormalized from document for query performance)
    source_type TEXT NOT NULL,
    source_uri TEXT,
    tenant_id TEXT,
    section_header TEXT,
    has_code_block BOOLEAN NOT NULL DEFAULT FALSE,
    is_summary_chunk BOOLEAN NOT NULL DEFAULT FALSE,
    tags TEXT[] DEFAULT '{}',
    labels TEXT[] DEFAULT '{}',
    service TEXT,
    component TEXT,

    -- Embedding tracking
    embedding_model TEXT,
    embedding_dimensions INTEGER,
    embedding_generated_at TIMESTAMP,
    is_embedded BOOLEAN NOT NULL DEFAULT FALSE,

    -- Vector store tracking
    vector_store_collection TEXT,
    is_indexed BOOLEAN NOT NULL DEFAULT FALSE,
    indexed_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_chunk_index_positive CHECK (chunk_index >= 0),
    CONSTRAINT chk_token_count_positive CHECK (token_count >= 0),
    CONSTRAINT chk_char_count_positive CHECK (char_count >= 0)
);

-- Primary access pattern: get all chunks for a document version
CREATE INDEX IF NOT EXISTS idx_chunks_version
    ON chunks (version_id, chunk_index);

-- Get all chunks for a document (across versions)
CREATE INDEX IF NOT EXISTS idx_chunks_document
    ON chunks (document_id);

-- Deduplication: prevent same chunk at same position in same document
CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_dedup
    ON chunks (document_id, version_id, chunk_index, chunk_hash);

-- Find un-embedded chunks for batch processing
CREATE INDEX IF NOT EXISTS idx_chunks_not_embedded
    ON chunks (is_embedded, created_at)
    WHERE is_embedded = FALSE;

-- Find embedded but un-indexed chunks
CREATE INDEX IF NOT EXISTS idx_chunks_not_indexed
    ON chunks (is_indexed, embedding_generated_at)
    WHERE is_embedded = TRUE AND is_indexed = FALSE;

-- Content hash lookup for global deduplication
CREATE INDEX IF NOT EXISTS idx_chunks_hash
    ON chunks (chunk_hash);

-- Tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_chunks_tenant
    ON chunks (tenant_id, source_type)
    WHERE tenant_id IS NOT NULL;

-- Track embedding model versions for migration planning
-- When we switch models, we need to find all chunks embedded with the old model
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_model
    ON chunks (embedding_model)
    WHERE embedding_model IS NOT NULL;

-- Add lifecycle state tracking for the CHUNKED → EMBEDDED → INDEXED transitions
-- on the documents table (extends the existing lifecycle_state)
-- The existing lifecycle_state CHECK doesn't exist as a formal constraint,
-- but we ensure our code handles the new states properly.

COMMENT ON TABLE chunks IS
    'Atomic retrieval units. Each chunk links to a document version and contains '
    'a portion of text with metadata. Serves as system of record for rebuilding '
    'the vector store if needed.';

COMMENT ON COLUMN chunks.embedding_model IS
    'Name of the embedding model used (e.g., nomic-embed-text). '
    'Tracked for model migration: when switching models, find chunks '
    'embedded with the old model and re-embed them.';

COMMENT ON COLUMN chunks.vector_store_collection IS
    'Name of the ChromaDB collection where this chunk''s vector is stored. '
    'Used for targeted deletion during re-indexing.';
