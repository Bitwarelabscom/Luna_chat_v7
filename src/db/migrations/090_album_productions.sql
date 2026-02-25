-- Album production pipeline tables for mass music production

CREATE TABLE album_productions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  artist_name VARCHAR(200) NOT NULL,
  genre VARCHAR(100) NOT NULL,
  production_notes TEXT,
  album_count INTEGER NOT NULL DEFAULT 1,
  planning_model VARCHAR(100),
  lyrics_model VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning','planned','in_progress','completed','failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE album_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id UUID NOT NULL REFERENCES album_productions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  album_number INTEGER NOT NULL,
  album_title VARCHAR(300),
  album_theme TEXT,
  cover_art_path VARCHAR(500),
  song_count INTEGER NOT NULL DEFAULT 10,
  status VARCHAR(20) NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning','planned','in_progress','completed','failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE album_songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id UUID NOT NULL REFERENCES album_items(id) ON DELETE CASCADE,
  production_id UUID NOT NULL REFERENCES album_productions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  track_number INTEGER NOT NULL,
  title VARCHAR(300) NOT NULL,
  direction TEXT,
  style VARCHAR(500),
  genre_preset VARCHAR(50),
  workspace_path VARCHAR(500),
  lyrics_text TEXT,
  revision_count INTEGER DEFAULT 0,
  analysis_issues TEXT,
  suno_generation_id UUID REFERENCES suno_generations(id),
  status VARCHAR(30) NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','lyrics_wip','lyrics_review','lyrics_approved',
                      'suno_pending','suno_processing','completed','failed','skipped')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_album_songs_status ON album_songs(status);
CREATE INDEX idx_album_songs_production ON album_songs(production_id);
CREATE INDEX idx_album_items_production ON album_items(production_id);
