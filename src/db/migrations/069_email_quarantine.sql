-- Email quarantine table for Mail-Luna gatekeeper
-- Stores emails flagged as risky (prompt injection, phishing, etc.)

CREATE TABLE IF NOT EXISTS email_quarantine (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_uid INTEGER NOT NULL,
  from_address TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '(no subject)',
  received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  verdict JSONB NOT NULL,
  raw_body_hash VARCHAR(64) NOT NULL,
  quarantined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by UUID REFERENCES users(id),
  review_action VARCHAR(20),
  UNIQUE(email_uid)
);

CREATE INDEX IF NOT EXISTS idx_email_quarantine_pending
  ON email_quarantine(quarantined_at DESC) WHERE review_action IS NULL;
