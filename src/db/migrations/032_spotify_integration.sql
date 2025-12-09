-- Spotify integration for Luna
-- Links Luna users to automusic Spotify accounts and stores preferences

-- Spotify user preferences and device management
CREATE TABLE IF NOT EXISTS spotify_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    automusic_user_id INTEGER,
    spotify_id VARCHAR(255),
    preferred_device_id VARCHAR(255),
    preferred_device_name VARCHAR(255),
    last_device_id VARCHAR(255),
    last_device_name VARCHAR(255),
    auto_play_on_device BOOLEAN DEFAULT true,
    volume_default INTEGER DEFAULT 50,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Link Luna users to automusic users
CREATE TABLE IF NOT EXISTS spotify_user_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    luna_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    automusic_user_id INTEGER NOT NULL,
    spotify_id VARCHAR(255) NOT NULL,
    linked_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    UNIQUE(luna_user_id),
    UNIQUE(spotify_id)
);

-- Spotify playback history for proactive suggestions
CREATE TABLE IF NOT EXISTS spotify_playback_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id VARCHAR(255) NOT NULL,
    track_name VARCHAR(500),
    artist_names TEXT[],
    played_at TIMESTAMPTZ DEFAULT NOW(),
    context_type VARCHAR(50),
    context_uri VARCHAR(500),
    mood_at_time VARCHAR(50)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_spotify_prefs_user ON spotify_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_spotify_links_luna ON spotify_user_links(luna_user_id);
CREATE INDEX IF NOT EXISTS idx_spotify_links_spotify ON spotify_user_links(spotify_id);
CREATE INDEX IF NOT EXISTS idx_spotify_playback_user_time ON spotify_playback_log(user_id, played_at DESC);
