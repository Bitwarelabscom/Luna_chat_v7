-- Add forbidden words and custom song count to album productions
ALTER TABLE album_productions ADD COLUMN IF NOT EXISTS forbidden_words TEXT;
ALTER TABLE album_productions ADD COLUMN IF NOT EXISTS songs_per_album INTEGER;
