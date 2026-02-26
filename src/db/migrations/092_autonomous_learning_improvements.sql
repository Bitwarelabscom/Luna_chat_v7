-- Migration 092: Autonomous Learning Improvements
-- Adds retry lifecycle, hybrid scoring metrics, domain auto-discovery, and expanded trust database

-- =============================================
-- 1a. New columns on knowledge_gaps (retry lifecycle)
-- =============================================
ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS retry_count SMALLINT DEFAULT 0;
ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS retry_after TIMESTAMPTZ;
ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ;
ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS best_query TEXT;

-- Hard metrics from hybrid scoring
ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS mention_count INTEGER DEFAULT 0;
ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS session_count INTEGER DEFAULT 0;
ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS last_mentioned_at TIMESTAMPTZ;

-- Index for retry job
CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_retry_after
  ON knowledge_gaps(retry_after)
  WHERE status = 'retry_pending' AND retry_after IS NOT NULL;

-- =============================================
-- 1b. New columns on source_trust_scores (auto-discovery)
-- =============================================
ALTER TABLE source_trust_scores ADD COLUMN IF NOT EXISTS auto_discovered BOOLEAN DEFAULT false;
ALTER TABLE source_trust_scores ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ;
ALTER TABLE source_trust_scores ADD COLUMN IF NOT EXISTS discovery_context TEXT;

CREATE INDEX IF NOT EXISTS idx_source_trust_auto_discovered
  ON source_trust_scores(auto_discovered) WHERE auto_discovered = true;

-- =============================================
-- 1c. Expanded default trusted domains (~70 new entries)
-- =============================================

-- Language/framework docs (0.85-0.90)
INSERT INTO source_trust_scores (domain, trust_score, category, update_reason) VALUES
  ('typescriptlang.org', 0.90, 'language_docs', 'Official TypeScript documentation'),
  ('react.dev', 0.90, 'language_docs', 'Official React documentation'),
  ('angular.io', 0.88, 'language_docs', 'Official Angular documentation'),
  ('vuejs.org', 0.88, 'language_docs', 'Official Vue.js documentation'),
  ('svelte.dev', 0.88, 'language_docs', 'Official Svelte documentation'),
  ('nextjs.org', 0.88, 'language_docs', 'Official Next.js documentation'),
  ('swift.org', 0.90, 'language_docs', 'Official Swift documentation'),
  ('kotlinlang.org', 0.88, 'language_docs', 'Official Kotlin documentation'),
  ('ruby-lang.org', 0.88, 'language_docs', 'Official Ruby documentation'),
  ('php.net', 0.88, 'language_docs', 'Official PHP documentation'),
  ('cppreference.com', 0.88, 'language_docs', 'C++ reference documentation'),
  ('elixir-lang.org', 0.88, 'language_docs', 'Official Elixir documentation'),
  ('docs.nestjs.com', 0.85, 'language_docs', 'Official NestJS documentation'),
  ('expressjs.com', 0.85, 'language_docs', 'Official Express.js documentation')
ON CONFLICT (domain) DO NOTHING;

-- Official language/runtime docs (0.88-0.90)
INSERT INTO source_trust_scores (domain, trust_score, category, update_reason) VALUES
  ('python.org', 0.90, 'language_docs', 'Official Python documentation'),
  ('nodejs.org', 0.90, 'language_docs', 'Official Node.js documentation'),
  ('rust-lang.org', 0.90, 'language_docs', 'Official Rust documentation'),
  ('golang.org', 0.90, 'language_docs', 'Official Go documentation'),
  ('postgresql.org', 0.90, 'database_docs', 'Official PostgreSQL documentation'),
  ('kubernetes.io', 0.90, 'cloud_infra', 'Official Kubernetes documentation')
ON CONFLICT (domain) DO NOTHING;

-- Database docs (0.85-0.90)
INSERT INTO source_trust_scores (domain, trust_score, category, update_reason) VALUES
  ('redis.io', 0.88, 'database_docs', 'Official Redis documentation'),
  ('mongodb.com', 0.85, 'database_docs', 'Official MongoDB documentation'),
  ('elastic.co', 0.85, 'database_docs', 'Official Elasticsearch documentation'),
  ('clickhouse.com', 0.85, 'database_docs', 'Official ClickHouse documentation'),
  ('sqlite.org', 0.88, 'database_docs', 'Official SQLite documentation'),
  ('mariadb.org', 0.88, 'database_docs', 'Official MariaDB documentation')
ON CONFLICT (domain) DO NOTHING;

-- Cloud/infra (0.85-0.88)
INSERT INTO source_trust_scores (domain, trust_score, category, update_reason) VALUES
  ('terraform.io', 0.88, 'cloud_infra', 'Official Terraform documentation'),
  ('grafana.com', 0.85, 'cloud_infra', 'Official Grafana documentation'),
  ('prometheus.io', 0.85, 'cloud_infra', 'Official Prometheus documentation'),
  ('helm.sh', 0.85, 'cloud_infra', 'Official Helm documentation'),
  ('istio.io', 0.85, 'cloud_infra', 'Official Istio documentation'),
  ('docs.aws.amazon.com', 0.88, 'cloud_infra', 'Official AWS documentation'),
  ('cloud.google.com', 0.88, 'cloud_infra', 'Official Google Cloud documentation'),
  ('learn.microsoft.com', 0.88, 'cloud_infra', 'Official Microsoft documentation')
ON CONFLICT (domain) DO NOTHING;

-- Security (0.88-0.92)
INSERT INTO source_trust_scores (domain, trust_score, category, update_reason) VALUES
  ('owasp.org', 0.92, 'security', 'OWASP security standards'),
  ('letsencrypt.org', 0.90, 'security', 'Let''s Encrypt certificate authority'),
  ('cve.mitre.org', 0.92, 'security', 'CVE vulnerability database'),
  ('nvd.nist.gov', 0.92, 'security', 'National Vulnerability Database')
ON CONFLICT (domain) DO NOTHING;

-- Academic/.edu (0.88-0.92)
INSERT INTO source_trust_scores (domain, trust_score, category, update_reason) VALUES
  ('mit.edu', 0.92, 'academic', 'MIT - academic institution'),
  ('stanford.edu', 0.92, 'academic', 'Stanford University'),
  ('berkeley.edu', 0.90, 'academic', 'UC Berkeley'),
  ('cs.cmu.edu', 0.90, 'academic', 'Carnegie Mellon CS department'),
  ('ox.ac.uk', 0.90, 'academic', 'University of Oxford'),
  ('cam.ac.uk', 0.90, 'academic', 'University of Cambridge'),
  ('ethz.ch', 0.90, 'academic', 'ETH Zurich'),
  ('scholar.google.com', 0.88, 'academic', 'Google Scholar'),
  ('semanticscholar.org', 0.88, 'academic', 'Semantic Scholar'),
  ('researchgate.net', 0.75, 'academic', 'ResearchGate - mixed quality user content')
ON CONFLICT (domain) DO NOTHING;

-- Government/institutional (0.88-0.92)
INSERT INTO source_trust_scores (domain, trust_score, category, update_reason) VALUES
  ('nih.gov', 0.92, 'government', 'National Institutes of Health'),
  ('nsf.gov', 0.90, 'government', 'National Science Foundation'),
  ('energy.gov', 0.88, 'government', 'US Department of Energy'),
  ('esa.int', 0.90, 'government', 'European Space Agency'),
  ('cern.ch', 0.92, 'government', 'CERN research organization'),
  ('nist.gov', 0.92, 'government', 'National Institute of Standards and Technology'),
  ('nasa.gov', 0.92, 'government', 'NASA'),
  ('ietf.org', 0.92, 'government', 'Internet Engineering Task Force'),
  ('w3.org', 0.92, 'government', 'World Wide Web Consortium')
ON CONFLICT (domain) DO NOTHING;

-- Tech publications (0.75-0.82)
INSERT INTO source_trust_scores (domain, trust_score, category, update_reason) VALUES
  ('infoq.com', 0.80, 'tech_publication', 'InfoQ tech news'),
  ('martinfowler.com', 0.82, 'tech_publication', 'Martin Fowler - software architecture'),
  ('brendangregg.com', 0.82, 'tech_publication', 'Brendan Gregg - performance engineering'),
  ('blog.cloudflare.com', 0.82, 'tech_publication', 'Cloudflare engineering blog'),
  ('netflixtechblog.com', 0.80, 'tech_publication', 'Netflix tech blog'),
  ('ai.googleblog.com', 0.82, 'tech_publication', 'Google AI blog'),
  ('openai.com', 0.80, 'tech_publication', 'OpenAI research and blog'),
  ('huggingface.co', 0.78, 'tech_publication', 'Hugging Face ML platform')
ON CONFLICT (domain) DO NOTHING;
