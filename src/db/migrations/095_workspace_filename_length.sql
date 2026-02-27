-- Widen workspace_files.filename to support deeply nested paths
-- (e.g. dj-luna/My Project/Subfolder/song.md can exceed 255 chars)
ALTER TABLE workspace_files ALTER COLUMN filename TYPE VARCHAR(500);
