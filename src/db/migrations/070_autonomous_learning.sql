-- Autonomous Learning System Schema
-- Part of Luna's Friends knowledge evolution redesign

-- Source trust scores for research validation
CREATE TABLE IF NOT EXISTS source_trust_scores (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(255) UNIQUE NOT NULL,
  trust_score DECIMAL(3,2) NOT NULL CHECK (trust_score >= 0 AND trust_score <= 1),
  category VARCHAR(50), -- 'investigative_journalism', 'academic', 'technical', 'political_news', 'social', 'blog', 'reference'
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  update_reason TEXT
);

CREATE INDEX idx_source_trust_domain ON source_trust_scores(domain);
CREATE INDEX idx_source_trust_score ON source_trust_scores(trust_score DESC);
CREATE INDEX idx_source_trust_category ON source_trust_scores(category);

-- Knowledge gaps identified by session analysis
CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  gap_description TEXT NOT NULL,
  priority DECIMAL(3,2) CHECK (priority >= 0 AND priority <= 1), -- 0-1 priority score
  suggested_queries TEXT[], -- Array of search queries
  category VARCHAR(50), -- 'technical', 'current_events', 'personal_interest', 'academic'
  identified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'researching', 'verified', 'embedded', 'rejected', 'failed'
  research_session_id INTEGER, -- Link to research_sessions table
  failure_reason TEXT,
  completed_at TIMESTAMP
);

CREATE INDEX idx_knowledge_gaps_user ON knowledge_gaps(user_id);
CREATE INDEX idx_knowledge_gaps_status ON knowledge_gaps(status);
CREATE INDEX idx_knowledge_gaps_priority ON knowledge_gaps(priority DESC);

-- Research sessions for autonomous learning
CREATE TABLE IF NOT EXISTS autonomous_research_sessions (
  id SERIAL PRIMARY KEY,
  knowledge_gap_id INTEGER REFERENCES knowledge_gaps(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  search_queries TEXT[],
  sources_found INTEGER DEFAULT 0,
  trusted_sources_count INTEGER DEFAULT 0, -- Sources with trust >= 0.8
  findings JSONB, -- {sources: [{url, trust_score, summary}], key_facts: [...]}
  verification_result JSONB, -- {passed: boolean, confidence: number, reasoning: string}
  friend_discussion_id INTEGER, -- Link to friend_conversations table if friends discussed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX idx_research_sessions_gap ON autonomous_research_sessions(knowledge_gap_id);
CREATE INDEX idx_research_sessions_user ON autonomous_research_sessions(user_id);
CREATE INDEX idx_research_sessions_created ON autonomous_research_sessions(created_at DESC);

-- Autonomous learning audit log
CREATE TABLE IF NOT EXISTS autonomous_learning_log (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  action_type VARCHAR(50) NOT NULL, -- 'analysis', 'research', 'verification', 'embedding', 'notification'
  details JSONB NOT NULL, -- Action-specific data
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_learning_log_user ON autonomous_learning_log(user_id);
CREATE INDEX idx_learning_log_type ON autonomous_learning_log(action_type);
CREATE INDEX idx_learning_log_timestamp ON autonomous_learning_log(timestamp DESC);

-- Pre-configured trust scores based on user's trust model
INSERT INTO source_trust_scores (domain, trust_score, category, update_reason) VALUES
  -- Investigative Journalism (0.85)
  ('theguardian.com', 0.85, 'investigative_journalism', 'Initial configuration - investigative journalism'),
  ('vice.com', 0.85, 'investigative_journalism', 'Initial configuration - investigative journalism'),
  ('wired.com', 0.85, 'investigative_journalism', 'Initial configuration - investigative journalism'),
  ('propublica.org', 0.85, 'investigative_journalism', 'Initial configuration - investigative journalism'),
  ('theintercept.com', 0.85, 'investigative_journalism', 'Initial configuration - investigative journalism'),
  ('bellingcat.com', 0.85, 'investigative_journalism', 'Initial configuration - investigative journalism'),

  -- Technical/Academic (0.95)
  ('arxiv.org', 0.95, 'academic', 'Initial configuration - academic preprint'),
  ('ieee.org', 0.95, 'academic', 'Initial configuration - technical society'),
  ('nature.com', 0.95, 'academic', 'Initial configuration - peer-reviewed science'),
  ('science.org', 0.95, 'academic', 'Initial configuration - peer-reviewed science'),
  ('acm.org', 0.95, 'academic', 'Initial configuration - computing research'),
  ('springer.com', 0.95, 'academic', 'Initial configuration - academic publisher'),
  ('sciencedirect.com', 0.95, 'academic', 'Initial configuration - academic publisher'),

  -- Wikipedia (0.70)
  ('wikipedia.org', 0.70, 'reference', 'Initial configuration - crowdsourced encyclopedia'),
  ('en.wikipedia.org', 0.70, 'reference', 'Initial configuration - crowdsourced encyclopedia'),

  -- Developer Communities (0.75-0.80)
  ('stackoverflow.com', 0.80, 'technical', 'Initial configuration - developer Q&A'),
  ('dev.to', 0.75, 'technical', 'Initial configuration - developer community'),
  ('github.com', 0.80, 'technical', 'Initial configuration - code repository docs'),
  ('developer.mozilla.org', 0.85, 'technical', 'Initial configuration - web standards documentation'),
  ('docs.python.org', 0.85, 'technical', 'Initial configuration - official Python docs'),

  -- Political News - ANY country (0.1)
  ('cnn.com', 0.1, 'political_news', 'Initial configuration - political news'),
  ('nytimes.com', 0.1, 'political_news', 'Initial configuration - political news'),
  ('bbc.com', 0.1, 'political_news', 'Initial configuration - political news'),
  ('bbc.co.uk', 0.1, 'political_news', 'Initial configuration - political news'),
  ('foxnews.com', 0.1, 'political_news', 'Initial configuration - political news'),
  ('aljazeera.com', 0.1, 'political_news', 'Initial configuration - political news'),
  ('washingtonpost.com', 0.1, 'political_news', 'Initial configuration - political news'),
  ('reuters.com', 0.1, 'political_news', 'Initial configuration - political news'),
  ('apnews.com', 0.1, 'political_news', 'Initial configuration - political news'),

  -- Social Media (0.05-0.10)
  ('reddit.com', 0.10, 'social', 'Initial configuration - social discussion'),
  ('twitter.com', 0.05, 'social', 'Initial configuration - social media'),
  ('x.com', 0.05, 'social', 'Initial configuration - social media'),
  ('facebook.com', 0.05, 'social', 'Initial configuration - social media'),
  ('tiktok.com', 0.05, 'social', 'Initial configuration - social media'),
  ('instagram.com', 0.05, 'social', 'Initial configuration - social media'),

  -- Blogs (0.40-0.65)
  ('medium.com', 0.40, 'blog', 'Initial configuration - blog platform'),
  ('substack.com', 0.50, 'blog', 'Initial configuration - newsletter platform'),
  ('news.ycombinator.com', 0.65, 'tech_community', 'Initial configuration - HackerNews')
ON CONFLICT (domain) DO NOTHING;

-- Add foreign key for research_session_id in knowledge_gaps
ALTER TABLE knowledge_gaps
  ADD CONSTRAINT fk_knowledge_gaps_research_session
  FOREIGN KEY (research_session_id)
  REFERENCES autonomous_research_sessions(id)
  ON DELETE SET NULL;

-- Add foreign key for friend_discussion_id in research_sessions
-- This will be added after verifying friend_conversations table exists
-- ALTER TABLE autonomous_research_sessions
--   ADD CONSTRAINT fk_research_sessions_friend_discussion
--   FOREIGN KEY (friend_discussion_id)
--   REFERENCES friend_conversations(id)
--   ON DELETE SET NULL;
