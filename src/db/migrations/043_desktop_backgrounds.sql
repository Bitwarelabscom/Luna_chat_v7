-- Desktop backgrounds for Luna UI customization
CREATE TABLE IF NOT EXISTS desktop_backgrounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    image_url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500),
    background_type VARCHAR(50) NOT NULL CHECK (background_type IN ('generated', 'uploaded', 'preset')),
    style VARCHAR(50),
    prompt TEXT,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Only one active background per user (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_desktop_backgrounds_active
    ON desktop_backgrounds(user_id) WHERE is_active = true;

-- Index for faster lookups by user
CREATE INDEX IF NOT EXISTS idx_desktop_backgrounds_user_id
    ON desktop_backgrounds(user_id);
