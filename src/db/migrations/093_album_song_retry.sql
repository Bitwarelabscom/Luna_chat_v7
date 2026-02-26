-- Migration 093: Add retry_count to album_songs for failed song retry logic
-- When Suno generation fails (browser crash, timeout), songs can now be retried up to 3 times

ALTER TABLE album_songs ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

-- Index for efficiently finding retryable failed songs
CREATE INDEX IF NOT EXISTS idx_album_songs_failed_retry
  ON album_songs(production_id, retry_count)
  WHERE status = 'failed' AND retry_count < 3;
