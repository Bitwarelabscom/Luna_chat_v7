-- Migration 098: News Dashboard - cleanup + indexes
-- Clean old data (start fresh with 3-day window approach)
DELETE FROM rss_articles;

-- Index for queue queries (unenriched articles in recent window)
CREATE INDEX IF NOT EXISTS idx_rss_articles_unenriched
  ON rss_articles(published_at DESC) WHERE enriched_at IS NULL;
