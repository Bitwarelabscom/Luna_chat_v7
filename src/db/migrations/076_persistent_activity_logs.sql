-- Persistent Activity Logs
-- Update retention policy to keep logs indefinitely

-- ============================================
-- Update Archive Function - Never Archive (Keep in main table indefinitely)
-- ============================================

-- Option 1: Disable automatic archiving by making it only archive very old logs (10 years)
CREATE OR REPLACE FUNCTION archive_old_activity_logs(days_to_keep INTEGER DEFAULT 3650)
RETURNS INTEGER AS $$
DECLARE
    archived_count INTEGER;
BEGIN
    WITH moved AS (
        DELETE FROM activity_logs
        WHERE created_at < NOW() - (days_to_keep || ' days')::INTERVAL
        RETURNING *
    )
    INSERT INTO activity_archive (
        id, user_id, session_id, turn_id,
        category, event_type, level,
        title, message, details,
        source, duration_ms, created_at, archived_at
    )
    SELECT
        id, user_id, session_id, turn_id,
        category, event_type, level,
        title, message, details,
        source, duration_ms, created_at, NOW()
    FROM moved;

    GET DIAGNOSTICS archived_count = ROW_COUNT;
    RETURN archived_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Update Cleanup Function - Never Delete Archives
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_old_archives(days_to_keep INTEGER DEFAULT 36500)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Keep archives for 100 years (essentially indefinite)
    DELETE FROM activity_archive
    WHERE archived_at < NOW() - (days_to_keep || ' days')::INTERVAL;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Comment for documentation
-- ============================================

COMMENT ON FUNCTION archive_old_activity_logs IS 'Archives activity logs older than specified days (default: 3650 days / 10 years for persistence)';
COMMENT ON FUNCTION cleanup_old_archives IS 'Cleans up archived logs older than specified days (default: 36500 days / 100 years for indefinite retention)';
