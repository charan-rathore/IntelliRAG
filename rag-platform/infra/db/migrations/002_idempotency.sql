CREATE UNIQUE INDEX IF NOT EXISTS idx_document_versions_doc_hash
    ON document_versions (document_id, hash_payload);

CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_payloads_doc_hash
    ON raw_payloads (document_id, hash_payload);