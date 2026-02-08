-- Add tags and confidence to rss_articles
ALTER TABLE rss_articles
ADD COLUMN IF NOT EXISTS tags TEXT[],
ADD COLUMN IF NOT EXISTS confidence FLOAT DEFAULT 0;
