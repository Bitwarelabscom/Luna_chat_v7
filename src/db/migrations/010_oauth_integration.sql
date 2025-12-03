-- Luna Chat OAuth Integration Schema
-- Phase 4: OAuth flow management and bidirectional sync

-- ============================================
-- OAUTH STATE MANAGEMENT (CSRF Protection)
-- ============================================
CREATE TABLE IF NOT EXISTS oauth_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- google, microsoft
    state_token VARCHAR(255) NOT NULL UNIQUE,
    code_verifier TEXT, -- For PKCE flow
    scopes TEXT[] DEFAULT '{}',
    redirect_uri TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_token ON oauth_states(state_token);
CREATE INDEX IF NOT EXISTS idx_oauth_states_user ON oauth_states(user_id);

-- Cleanup expired states automatically (handled by background job)
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);

-- ============================================
-- SYNC STATUS TRACKING
-- ============================================
CREATE TABLE IF NOT EXISTS sync_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID NOT NULL,
    connection_type VARCHAR(20) NOT NULL, -- calendar, email
    sync_token TEXT, -- Provider sync token for incremental sync
    page_token TEXT, -- For paginated syncs
    last_full_sync TIMESTAMPTZ,
    last_incremental_sync TIMESTAMPTZ,
    last_sync_error TEXT,
    consecutive_errors INTEGER DEFAULT 0,
    is_paused BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(connection_id, connection_type)
);

CREATE INDEX IF NOT EXISTS idx_sync_status_connection ON sync_status(connection_id);

-- ============================================
-- OUTBOUND SYNC QUEUE (Two-way sync)
-- ============================================
CREATE TABLE IF NOT EXISTS outbound_sync_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL,
    connection_type VARCHAR(20) NOT NULL, -- calendar, email
    operation VARCHAR(20) NOT NULL, -- create, update, delete
    entity_type VARCHAR(50) NOT NULL, -- event, email, task
    entity_id UUID, -- Local entity ID
    external_id VARCHAR(255), -- Remote entity ID for updates/deletes
    entity_data JSONB NOT NULL, -- Data to sync
    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, completed, failed
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,
    scheduled_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_queue_user ON outbound_sync_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_outbound_queue_status ON outbound_sync_queue(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_outbound_queue_connection ON outbound_sync_queue(connection_id);

-- ============================================
-- ENTITY MAPPING (Local <-> External IDs)
-- ============================================
CREATE TABLE IF NOT EXISTS entity_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL,
    entity_type VARCHAR(50) NOT NULL, -- event, email, task
    local_id UUID NOT NULL,
    external_id VARCHAR(255) NOT NULL,
    external_etag VARCHAR(255), -- For conflict detection
    last_synced TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(connection_id, entity_type, local_id),
    UNIQUE(connection_id, entity_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_mappings_local ON entity_mappings(local_id);
CREATE INDEX IF NOT EXISTS idx_entity_mappings_external ON entity_mappings(external_id);

-- ============================================
-- INTEGRATION EVENTS LOG (For debugging)
-- ============================================
CREATE TABLE IF NOT EXISTS integration_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID,
    provider VARCHAR(50) NOT NULL,
    event_type VARCHAR(50) NOT NULL, -- auth_started, auth_completed, sync_started, sync_completed, error
    event_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_events_user ON integration_events(user_id);
CREATE INDEX IF NOT EXISTS idx_integration_events_time ON integration_events(created_at DESC);

-- Partition or cleanup old events (keep 30 days)
CREATE INDEX IF NOT EXISTS idx_integration_events_cleanup ON integration_events(created_at);

-- ============================================
-- ENHANCE EXISTING CALENDAR/EMAIL TABLES
-- ============================================

-- Add encrypted token storage columns if not exists
ALTER TABLE calendar_connections
ADD COLUMN IF NOT EXISTS access_token_encrypted TEXT,
ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT,
ADD COLUMN IF NOT EXISTS encryption_key_id VARCHAR(50);

ALTER TABLE email_connections
ADD COLUMN IF NOT EXISTS access_token_encrypted TEXT,
ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT,
ADD COLUMN IF NOT EXISTS encryption_key_id VARCHAR(50);

-- ============================================
-- TRIGGERS
-- ============================================
DROP TRIGGER IF EXISTS update_sync_status_updated_at ON sync_status;
CREATE TRIGGER update_sync_status_updated_at
    BEFORE UPDATE ON sync_status
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Cleanup old OAuth states (more than 15 minutes)
-- This would be handled by a background job, but we can add a rule for safety
