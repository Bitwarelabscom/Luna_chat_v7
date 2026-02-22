-- Luna Friends verification pipeline
-- Topic mining -> claim generation -> user verification -> memory injection

CREATE TABLE IF NOT EXISTS friend_topic_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type VARCHAR(30) NOT NULL DEFAULT 'session_pattern' CHECK (source_type IN ('session_pattern', 'discussion', 'manual')),
  topic_text TEXT NOT NULL,
  context TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  model_confidence DECIMAL(4,3) NOT NULL DEFAULT 0,
  relevance_score DECIMAL(4,3) NOT NULL DEFAULT 0,
  threshold_score DECIMAL(4,3) NOT NULL DEFAULT 0.60,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'consumed')),
  considered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_friend_topic_candidates_user_status ON friend_topic_candidates(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_friend_topic_candidates_user_created ON friend_topic_candidates(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS friend_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES friend_conversations(id) ON DELETE SET NULL,
  session_id UUID REFERENCES autonomous_sessions(id) ON DELETE SET NULL,
  topic_candidate_id UUID REFERENCES friend_topic_candidates(id) ON DELETE SET NULL,
  claim_text TEXT NOT NULL,
  rationale TEXT,
  confidence DECIMAL(4,3) NOT NULL DEFAULT 0.70,
  status VARCHAR(30) NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('pending_verification', 'question_asked', 'verified', 'rejected', 'unclear', 'dismissed')),
  verification_resolution VARCHAR(20) CHECK (verification_resolution IN ('confirmed', 'denied', 'unclear')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_friend_claims_user_status ON friend_claims(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_friend_claims_conversation ON friend_claims(conversation_id);

CREATE TABLE IF NOT EXISTS friend_claim_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim_id UUID NOT NULL REFERENCES friend_claims(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES autonomous_questions(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  answer_text TEXT,
  answer_confidence DECIMAL(4,3),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'expired', 'dismissed')),
  resolution VARCHAR(20) CHECK (resolution IN ('confirmed', 'denied', 'unclear')),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (claim_id),
  UNIQUE (question_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_claim_verifications_user_status ON friend_claim_verifications(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_friend_claim_verifications_question ON friend_claim_verifications(question_id);

-- Keep updated_at fresh on updates
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_friend_topic_candidates_updated_at ON friend_topic_candidates;
CREATE TRIGGER trg_friend_topic_candidates_updated_at
BEFORE UPDATE ON friend_topic_candidates
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_friend_claims_updated_at ON friend_claims;
CREATE TRIGGER trg_friend_claims_updated_at
BEFORE UPDATE ON friend_claims
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_friend_claim_verifications_updated_at ON friend_claim_verifications;
CREATE TRIGGER trg_friend_claim_verifications_updated_at
BEFORE UPDATE ON friend_claim_verifications
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
