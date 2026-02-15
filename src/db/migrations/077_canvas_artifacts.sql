-- Migration 077: Canvas Artifacts System
-- Adds tables for Open Canvas-style artifact generation, versioning, and quick actions

-- Core artifact storage with version tracking
CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  current_index INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Immutable version history for each artifact
CREATE TABLE IF NOT EXISTS artifact_contents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID REFERENCES artifacts(id) ON DELETE CASCADE NOT NULL,
  index INTEGER NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('code', 'text')),
  title VARCHAR(255) NOT NULL,
  language VARCHAR(50),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(artifact_id, index)
);

-- User-defined quick actions for artifact editing
CREATE TABLE IF NOT EXISTS quick_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  title VARCHAR(100) NOT NULL,
  prompt TEXT NOT NULL,
  include_reflections BOOLEAN DEFAULT false,
  include_prefix BOOLEAN DEFAULT true,
  include_recent_history BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Style rules and content preferences for artifact generation
CREATE TABLE IF NOT EXISTS reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('style_rule', 'content')),
  value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_artifacts_user_session ON artifacts(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_artifact_contents_artifact ON artifact_contents(artifact_id, index);
CREATE INDEX IF NOT EXISTS idx_quick_actions_user ON quick_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_reflections_user ON reflections(user_id, type);
