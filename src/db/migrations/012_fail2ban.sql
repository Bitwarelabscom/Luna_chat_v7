-- Fail2ban IP bans table
-- Tracks failed login attempts and banned IPs

CREATE TABLE IF NOT EXISTS ip_bans (
    ip VARCHAR(45) PRIMARY KEY,  -- Supports IPv4 and IPv6
    failed_attempts INTEGER DEFAULT 0,
    banned_until TIMESTAMPTZ,
    last_attempt TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for finding active bans
CREATE INDEX IF NOT EXISTS idx_ip_bans_banned_until ON ip_bans(banned_until) WHERE banned_until IS NOT NULL;

-- Index for cleanup of old records
CREATE INDEX IF NOT EXISTS idx_ip_bans_last_attempt ON ip_bans(last_attempt);

-- Function to clean up old, unbanned records (older than 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_ip_bans()
RETURNS void AS $$
BEGIN
    DELETE FROM ip_bans
    WHERE banned_until IS NULL
    AND last_attempt < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE ip_bans IS 'Tracks failed login attempts and banned IPs (fail2ban style)';
COMMENT ON COLUMN ip_bans.ip IS 'Client IP address (IPv4 or IPv6)';
COMMENT ON COLUMN ip_bans.failed_attempts IS 'Number of consecutive failed login attempts';
COMMENT ON COLUMN ip_bans.banned_until IS 'Timestamp when ban expires (NULL if not banned)';
COMMENT ON COLUMN ip_bans.last_attempt IS 'Timestamp of last login attempt';
