-- News classification and alert system

-- Add classification columns to rss_articles
ALTER TABLE rss_articles ADD COLUMN IF NOT EXISTS category VARCHAR(50);
ALTER TABLE rss_articles ADD COLUMN IF NOT EXISTS priority VARCHAR(2);
ALTER TABLE rss_articles ADD COLUMN IF NOT EXISTS priority_reason TEXT;
ALTER TABLE rss_articles ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) DEFAULT 'newsfetcher';
ALTER TABLE rss_articles ADD COLUMN IF NOT EXISTS newsfetcher_id INTEGER;
ALTER TABLE rss_articles ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;
ALTER TABLE rss_articles ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN DEFAULT false;

-- Make feed_id nullable (articles from newsfetcher won't have a local feed)
ALTER TABLE rss_articles ALTER COLUMN feed_id DROP NOT NULL;

-- News alert thresholds per user per category
CREATE TABLE IF NOT EXISTS news_alert_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL,
  min_priority VARCHAR(2) NOT NULL DEFAULT 'P1',
  delivery_method VARCHAR(20) NOT NULL DEFAULT 'telegram',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rss_articles_category ON rss_articles(category);
CREATE INDEX IF NOT EXISTS idx_rss_articles_priority ON rss_articles(priority);
CREATE INDEX IF NOT EXISTS idx_rss_articles_enriched ON rss_articles(enriched_at);
CREATE INDEX IF NOT EXISTS idx_rss_articles_newsfetcher_id ON rss_articles(newsfetcher_id);
CREATE INDEX IF NOT EXISTS idx_rss_articles_notification ON rss_articles(notification_sent) WHERE notification_sent = false;
