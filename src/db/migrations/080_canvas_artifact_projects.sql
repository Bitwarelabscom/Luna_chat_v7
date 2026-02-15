-- Migration 080: Canvas Artifact Projects (multi-file + snapshots)

-- Current working files for each artifact project
CREATE TABLE IF NOT EXISTS artifact_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID REFERENCES artifacts(id) ON DELETE CASCADE NOT NULL,
  path TEXT NOT NULL,
  file_type VARCHAR(20) NOT NULL CHECK (file_type IN ('code', 'text', 'image', 'asset')),
  language VARCHAR(50),
  storage VARCHAR(10) NOT NULL CHECK (storage IN ('db', 'fs')),
  content TEXT,
  fs_path TEXT,
  mime_type VARCHAR(255),
  size_bytes BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (artifact_id, path)
);

-- Immutable snapshots for whole artifact projects
CREATE TABLE IF NOT EXISTS artifact_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID REFERENCES artifacts(id) ON DELETE CASCADE NOT NULL,
  version_index INTEGER NOT NULL,
  summary TEXT,
  entry_file TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (artifact_id, version_index)
);

-- Files captured in each snapshot
CREATE TABLE IF NOT EXISTS artifact_snapshot_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID REFERENCES artifact_snapshots(id) ON DELETE CASCADE NOT NULL,
  path TEXT NOT NULL,
  file_type VARCHAR(20) NOT NULL CHECK (file_type IN ('code', 'text', 'image', 'asset')),
  language VARCHAR(50),
  storage VARCHAR(10) NOT NULL CHECK (storage IN ('db', 'fs')),
  content TEXT,
  fs_path TEXT,
  mime_type VARCHAR(255),
  size_bytes BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (snapshot_id, path)
);

-- Optional one-to-one link between a canvas artifact and a project
CREATE TABLE IF NOT EXISTS artifact_project_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID REFERENCES artifacts(id) ON DELETE CASCADE NOT NULL UNIQUE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artifact_files_artifact ON artifact_files(artifact_id);
CREATE INDEX IF NOT EXISTS idx_artifact_files_path ON artifact_files(artifact_id, path);
CREATE INDEX IF NOT EXISTS idx_artifact_snapshots_artifact ON artifact_snapshots(artifact_id, version_index);
CREATE INDEX IF NOT EXISTS idx_artifact_snapshot_files_snapshot ON artifact_snapshot_files(snapshot_id, path);

