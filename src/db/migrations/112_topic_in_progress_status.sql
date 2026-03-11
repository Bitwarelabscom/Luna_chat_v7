-- Migration 112: Add 'in_progress' status to friend_topic_candidates
-- Prevents topic loss when discussion creation fails after marking consumed

-- Update the check constraint to allow 'in_progress' status
ALTER TABLE friend_topic_candidates
  DROP CONSTRAINT friend_topic_candidates_status_check;

ALTER TABLE friend_topic_candidates
  ADD CONSTRAINT friend_topic_candidates_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'consumed', 'in_progress'));

-- Update the partial index to include 'in_progress' in the gossip queue index
DROP INDEX IF EXISTS idx_friend_topic_candidates_gossip_queue;
CREATE INDEX idx_friend_topic_candidates_gossip_queue
  ON friend_topic_candidates (user_id, status, importance DESC, created_at DESC)
  WHERE status IN ('pending', 'approved', 'in_progress');

-- Safety net: revert any stale in_progress topics older than 1 hour
-- (handles crashes/restarts where revert didn't fire)
UPDATE friend_topic_candidates
  SET status = 'approved', considered_at = NULL
  WHERE status = 'in_progress'
    AND considered_at < NOW() - INTERVAL '1 hour';
