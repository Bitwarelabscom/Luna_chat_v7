-- Add gossip queue fields to friend_topic_candidates
-- importance: 1-5 star rating, motivation: why discuss this, suggested_friend_id: preferred friend

ALTER TABLE friend_topic_candidates
  ADD COLUMN IF NOT EXISTS importance SMALLINT NOT NULL DEFAULT 3
    CHECK (importance BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS motivation TEXT,
  ADD COLUMN IF NOT EXISTS suggested_friend_id UUID
    REFERENCES friend_personalities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_friend_topic_candidates_gossip_queue
  ON friend_topic_candidates(user_id, status, importance DESC, created_at DESC)
  WHERE status IN ('pending', 'approved');
