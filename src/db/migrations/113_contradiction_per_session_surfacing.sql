-- Migration 113: Per-session contradiction surfacing
-- Contradictions should surface across sessions, not just the session they were created in.
-- Track which sessions have seen each signal via a UUID array.

ALTER TABLE contradiction_signals
  ADD COLUMN surfaced_session_ids UUID[] NOT NULL DEFAULT '{}';

-- Backfill: signals already marked surfaced get an empty array (already done)
-- New index: find unsurfaced signals by user, excluding specific sessions
DROP INDEX IF EXISTS idx_contradiction_signals_unsurfaced;
CREATE INDEX idx_contradiction_signals_unsurfaced
  ON contradiction_signals (user_id, created_at DESC)
  WHERE surfaced = FALSE;
