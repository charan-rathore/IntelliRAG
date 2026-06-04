CREATE TABLE IF NOT EXISTS documents (
    document_id UUID PRIMARY KEY,
    external_id TEXT NOT NULL,
    title TEXT,
    source_type TEXT NOT NULL,
    source_uri TEXT,
    tenant_id TEXT,
    owners TEXT[],
    tags TEXT[],
    labels TEXT[],
    environment TEXT,
    service TEXT,
    component TEXT,
    access_policy JSONB,
    hash_content TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    ingested_at TIMESTAMP NOT NULL,
    lifecycle_state TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_source_external
    ON documents (source_type, external_id, tenant_id);

CREATE TABLE IF NOT EXISTS document_versions (
    version_id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    version_index INT NOT NULL,
    body_raw_uri TEXT,
    body_text TEXT,
    source_payload_uri TEXT,
    hash_payload TEXT NOT NULL,
    valid_from TIMESTAMP NOT NULL,
    valid_to TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_document_versions_doc
    ON document_versions (document_id, is_active);

CREATE TABLE IF NOT EXISTS raw_payloads (
    payload_id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_uri TEXT,
    storage_uri TEXT NOT NULL,
    hash_payload TEXT NOT NULL,
    received_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_raw_payloads_doc
    ON raw_payloads (document_id);
