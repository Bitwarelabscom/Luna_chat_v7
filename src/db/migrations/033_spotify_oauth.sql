-- Direct Spotify OAuth for Luna users
-- Allows Luna to authenticate directly with Spotify without automusic

CREATE TABLE IF NOT EXISTS spotify_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spotify_id VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    email VARCHAR(255),
    access_token TEXT NOT NULL,  -- Encrypted with Luna's encryption key
    refresh_token TEXT NOT NULL, -- Encrypted with Luna's encryption key
    token_expires_at TIMESTAMPTZ NOT NULL,
    scopes TEXT[], -- Array of granted scopes
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id),
    UNIQUE(spotify_id)
);

-- Update spotify_user_links to support direct tokens
ALTER TABLE spotify_user_links
ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'automusic';
-- source can be 'automusic' or 'direct'

CREATE INDEX IF NOT EXISTS idx_spotify_tokens_user ON spotify_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_spotify_tokens_spotify ON spotify_tokens(spotify_id);
