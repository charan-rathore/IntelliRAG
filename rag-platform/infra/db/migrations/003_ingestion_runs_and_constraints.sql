-- Ingestion run tracking and stronger constraints

CREATE TABLE IF NOT EXISTS ingestion_runs (
    run_id UUID PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_uri TEXT,
    external_id TEXT,
    document_id UUID REFERENCES documents(document_id) ON DELETE SET NULL,
    payload_hash TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    started_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_source
    ON ingestion_runs (source_type, external_id);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status
    ON ingestion_runs (status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_document
    ON ingestion_runs (document_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_documents_source_external'
    ) THEN
        ALTER TABLE documents
            ADD CONSTRAINT uq_documents_source_external
            UNIQUE (source_type, external_id, tenant_id);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_versions_doc_version
    ON document_versions (document_id, version_index);

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_versions_single_active
    ON document_versions (document_id)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_documents_source_uri
    ON documents (source_uri);

CREATE INDEX IF NOT EXISTS idx_raw_payloads_hash
    ON raw_payloads (hash_payload);
