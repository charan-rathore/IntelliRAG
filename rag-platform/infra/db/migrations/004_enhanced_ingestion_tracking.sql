-- Enhanced ingestion tracking: error codes, retry tracking, and lifecycle events
-- Migration 004: Production-grade ingestion observability

-- Add structured error tracking to ingestion_runs
ALTER TABLE ingestion_runs
    ADD COLUMN IF NOT EXISTS error_code TEXT,
    ADD COLUMN IF NOT EXISTS error_category TEXT,
    ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS trace_id TEXT,
    ADD COLUMN IF NOT EXISTS is_retryable BOOLEAN DEFAULT FALSE;

-- Index for filtering by error category (operational dashboards)
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_error_category
    ON ingestion_runs (error_category, started_at DESC)
    WHERE error_category IS NOT NULL;

-- Index for trace correlation (debugging)
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_trace
    ON ingestion_runs (trace_id)
    WHERE trace_id IS NOT NULL;

-- Lifecycle events table: tracks status transitions for audit and debugging
-- WHY THIS TABLE EXISTS:
-- The ingestion_runs table only stores the CURRENT status. This table stores
-- the full history of status transitions. Essential for debugging "what happened
-- between VALIDATED and FAILED?" and calculating time-in-state metrics.
CREATE TABLE IF NOT EXISTS ingestion_run_events (
    event_id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES ingestion_runs(run_id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    previous_status TEXT,
    event_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    duration_since_previous_ms INTEGER,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_run_events_run
    ON ingestion_run_events (run_id, event_timestamp);

CREATE INDEX IF NOT EXISTS idx_run_events_status
    ON ingestion_run_events (status, event_timestamp DESC);

-- Add CHECK constraint for valid status values
-- This prevents typos in status strings from corrupting data
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_ingestion_runs_status'
    ) THEN
        ALTER TABLE ingestion_runs
            ADD CONSTRAINT chk_ingestion_runs_status
            CHECK (status IN (
                'received',
                'validated',
                'dedupe_checked',
                'raw_stored',
                'registered',
                'skipped_no_change',
                'failed'
            ));
    END IF;
END $$;

-- Add CHECK constraint for valid error categories
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_ingestion_runs_error_category'
    ) THEN
        ALTER TABLE ingestion_runs
            ADD CONSTRAINT chk_ingestion_runs_error_category
            CHECK (error_category IS NULL OR error_category IN (
                'validation',
                'transient',
                'infrastructure',
                'internal'
            ));
    END IF;
END $$;

-- Function to automatically record lifecycle events on status change
-- This trigger ensures we never miss a status transition
CREATE OR REPLACE FUNCTION record_ingestion_status_change()
RETURNS TRIGGER AS $$
DECLARE
    prev_event RECORD;
    duration_ms INTEGER;
BEGIN
    -- Get the previous event for this run to calculate duration
    SELECT * INTO prev_event
    FROM ingestion_run_events
    WHERE run_id = NEW.run_id
    ORDER BY event_timestamp DESC
    LIMIT 1;
    
    -- Calculate duration since previous status
    IF prev_event IS NOT NULL THEN
        duration_ms := EXTRACT(EPOCH FROM (NOW() - prev_event.event_timestamp)) * 1000;
    ELSE
        duration_ms := NULL;
    END IF;
    
    -- Only record if status actually changed
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO ingestion_run_events (
            event_id,
            run_id,
            status,
            previous_status,
            event_timestamp,
            duration_since_previous_ms,
            metadata
        ) VALUES (
            gen_random_uuid(),
            NEW.run_id,
            NEW.status,
            OLD.status,
            NOW(),
            duration_ms,
            jsonb_build_object(
                'error_code', NEW.error_code,
                'error_message', NEW.error_message,
                'payload_hash', NEW.payload_hash
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for status change tracking
DROP TRIGGER IF EXISTS trg_record_ingestion_status ON ingestion_runs;
CREATE TRIGGER trg_record_ingestion_status
    AFTER UPDATE ON ingestion_runs
    FOR EACH ROW
    EXECUTE FUNCTION record_ingestion_status_change();

-- Also record the initial status on INSERT
CREATE OR REPLACE FUNCTION record_ingestion_initial_status()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO ingestion_run_events (
        event_id,
        run_id,
        status,
        previous_status,
        event_timestamp,
        duration_since_previous_ms,
        metadata
    ) VALUES (
        gen_random_uuid(),
        NEW.run_id,
        NEW.status,
        NULL,
        NOW(),
        NULL,
        jsonb_build_object(
            'source_type', NEW.source_type,
            'external_id', NEW.external_id
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_record_ingestion_initial ON ingestion_runs;
CREATE TRIGGER trg_record_ingestion_initial
    AFTER INSERT ON ingestion_runs
    FOR EACH ROW
    EXECUTE FUNCTION record_ingestion_initial_status();

-- Add schema_version to documents for future migration tracking
ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS schema_version INTEGER DEFAULT 1;

-- Add content checksum to raw_payloads for integrity verification
ALTER TABLE raw_payloads
    ADD COLUMN IF NOT EXISTS content_checksum TEXT;

-- Comment explaining the schema
COMMENT ON TABLE ingestion_run_events IS 
    'Audit log of all status transitions for ingestion runs. Used for debugging and metrics.';

COMMENT ON COLUMN ingestion_runs.error_code IS 
    'Structured error code for programmatic handling (e.g., validation_schema_mismatch)';

COMMENT ON COLUMN ingestion_runs.error_category IS 
    'High-level category: validation, transient, infrastructure, internal';

COMMENT ON COLUMN ingestion_runs.trace_id IS 
    'Correlation ID for tracing a request across services and logs';

COMMENT ON COLUMN ingestion_runs.retry_count IS 
    'Number of times this run has been retried';
