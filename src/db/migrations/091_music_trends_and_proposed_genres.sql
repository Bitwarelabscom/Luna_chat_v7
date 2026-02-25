-- Proposed genre presets (from trend analysis, pending user approval)
CREATE TABLE IF NOT EXISTS proposed_genre_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  genre_id VARCHAR(60) NOT NULL,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(30) NOT NULL,
  preset_data JSONB NOT NULL,
  source_signal_id UUID,
  confidence NUMERIC(6,3) NOT NULL DEFAULT 0.5,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_proposed_genres_user ON proposed_genre_presets(user_id, status);

-- Raw scraped music trend data
CREATE TABLE IF NOT EXISTS music_trend_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(40) NOT NULL,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_data JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_music_trend_raw_unprocessed ON music_trend_raw(processed, scraped_at DESC);

-- Add music_trend signal type to ceo_market_signals
ALTER TABLE ceo_market_signals DROP CONSTRAINT IF EXISTS ceo_market_signals_signal_type_check;
ALTER TABLE ceo_market_signals ADD CONSTRAINT ceo_market_signals_signal_type_check
  CHECK (signal_type IN ('opportunity','threat','pricing','policy','trend','music_trend'));
