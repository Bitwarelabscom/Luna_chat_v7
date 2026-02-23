-- Migration 084: CEO Luna continuous monitoring mode
-- Adds pre-revenue finance logging, project/growth tracking, alerting,
-- reporting, and autopost queue infrastructure.

CREATE TABLE IF NOT EXISTS ceo_configs (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode VARCHAR(20) NOT NULL DEFAULT 'pre_revenue' CHECK (mode IN ('pre_revenue', 'normal')),
  timezone VARCHAR(80) NOT NULL DEFAULT 'Europe/Stockholm',
  no_build_days_threshold INTEGER NOT NULL DEFAULT 2,
  no_experiment_days_threshold INTEGER NOT NULL DEFAULT 3,
  burn_spike_ratio NUMERIC(6,3) NOT NULL DEFAULT 1.300,
  burn_spike_absolute_usd NUMERIC(12,2) NOT NULL DEFAULT 150,
  unexpected_new_vendor_usd NUMERIC(12,2) NOT NULL DEFAULT 100,
  unexpected_vendor_multiplier NUMERIC(6,3) NOT NULL DEFAULT 2.000,
  daily_morning_time TIME NOT NULL DEFAULT '08:00',
  daily_evening_time TIME NOT NULL DEFAULT '20:00',
  weekly_report_weekday SMALLINT NOT NULL DEFAULT 0 CHECK (weekly_report_weekday BETWEEN 0 AND 6),
  weekly_report_time TIME NOT NULL DEFAULT '18:00',
  biweekly_audit_weekday SMALLINT NOT NULL DEFAULT 1 CHECK (biweekly_audit_weekday BETWEEN 0 AND 6),
  biweekly_audit_time TIME NOT NULL DEFAULT '10:00',
  competitors JSONB NOT NULL DEFAULT '[]'::jsonb,
  autopost_priority JSONB NOT NULL DEFAULT '["x", "linkedin", "telegram", "blog"]'::jsonb,
  autopost_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ceo_finance_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_on DATE NOT NULL,
  entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('expense', 'income')),
  vendor VARCHAR(120) NOT NULL,
  amount_usd NUMERIC(12,2) NOT NULL CHECK (amount_usd >= 0),
  category VARCHAR(40) NOT NULL DEFAULT 'other',
  cadence VARCHAR(20) NOT NULL DEFAULT 'one_time' CHECK (cadence IN ('one_time', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
  notes TEXT,
  source VARCHAR(20) NOT NULL DEFAULT 'telegram',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ceo_finance_user_date ON ceo_finance_entries(user_id, occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_ceo_finance_user_vendor ON ceo_finance_entries(user_id, vendor, occurred_on DESC);

CREATE TABLE IF NOT EXISTS ceo_build_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_key VARCHAR(120) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hours NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (hours >= 0),
  item TEXT,
  stage VARCHAR(30) NOT NULL DEFAULT 'building' CHECK (stage IN ('planning', 'build', 'building', 'blocked', 'review', 'paused', 'done')),
  impact VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (impact IN ('low', 'medium', 'high')),
  source VARCHAR(20) NOT NULL DEFAULT 'telegram',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ceo_build_user_time ON ceo_build_logs(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ceo_build_user_project ON ceo_build_logs(user_id, project_key, occurred_at DESC);

CREATE TABLE IF NOT EXISTS ceo_growth_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_on DATE NOT NULL,
  channel VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  cost_usd NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  leads INTEGER NOT NULL DEFAULT 0 CHECK (leads >= 0),
  outcome VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'win', 'loss', 'mixed')),
  status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('planned', 'running', 'completed')),
  notes TEXT,
  source VARCHAR(20) NOT NULL DEFAULT 'telegram',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ceo_growth_user_date ON ceo_growth_experiments(user_id, occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_ceo_growth_user_channel ON ceo_growth_experiments(user_id, channel, occurred_on DESC);

CREATE TABLE IF NOT EXISTS ceo_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_on DATE NOT NULL,
  source VARCHAR(60) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost')),
  value_estimate_usd NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ceo_leads_user_date ON ceo_leads(user_id, occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_ceo_leads_user_status ON ceo_leads(user_id, status, occurred_on DESC);

CREATE TABLE IF NOT EXISTS ceo_project_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_key VARCHAR(120) NOT NULL,
  stage VARCHAR(30) NOT NULL DEFAULT 'build' CHECK (stage IN ('idea', 'planning', 'build', 'blocked', 'distribution', 'monetizing', 'done')),
  revenue_potential_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
  estimated_hours NUMERIC(10,2) NOT NULL DEFAULT 1,
  strategic_leverage NUMERIC(6,3) NOT NULL DEFAULT 1,
  win_probability NUMERIC(6,3) NOT NULL DEFAULT 0.5,
  dependency_risk INTEGER NOT NULL DEFAULT 0,
  confidence_score NUMERIC(6,3) NOT NULL DEFAULT 0.5,
  notes TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ceo_project_snapshot_user ON ceo_project_snapshots(user_id, project_key, captured_at DESC);

CREATE TABLE IF NOT EXISTS ceo_market_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signal_type VARCHAR(20) NOT NULL CHECK (signal_type IN ('opportunity', 'threat', 'pricing', 'policy', 'trend')),
  title TEXT NOT NULL,
  summary TEXT,
  source_url TEXT,
  confidence NUMERIC(6,3) NOT NULL DEFAULT 0.5,
  actionable BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ceo_market_signals_user ON ceo_market_signals(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ceo_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  severity VARCHAR(2) NOT NULL CHECK (severity IN ('P1', 'P2', 'P3')),
  alert_type VARCHAR(60) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'sent', 'suppressed', 'resolved')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ceo_alerts_user_status ON ceo_alerts(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ceo_alerts_user_type ON ceo_alerts(user_id, alert_type, created_at DESC);

CREATE TABLE IF NOT EXISTS ceo_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_type VARCHAR(20) NOT NULL CHECK (report_type IN ('daily', 'weekly', 'biweekly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  headline VARCHAR(250) NOT NULL,
  body TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivered_via VARCHAR(20) NOT NULL DEFAULT 'telegram',
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ceo_reports_user_type ON ceo_reports(user_id, report_type, created_at DESC);

CREATE TABLE IF NOT EXISTS ceo_job_state (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_key VARCHAR(80) NOT NULL,
  last_run_slot VARCHAR(80) NOT NULL,
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, job_key)
);

CREATE TABLE IF NOT EXISTS ceo_autopost_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('x', 'linkedin', 'telegram', 'blog', 'reddit')),
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  posting_mode VARCHAR(20) NOT NULL DEFAULT 'approval' CHECK (posting_mode IN ('auto', 'approval')),
  webhook_path VARCHAR(200),
  channel_ref VARCHAR(120),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, channel)
);

CREATE TABLE IF NOT EXISTS ceo_autopost_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('x', 'linkedin', 'telegram', 'blog', 'reddit')),
  title VARCHAR(200),
  content TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'scheduled', 'posting', 'posted', 'failed', 'cancelled')),
  scheduled_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  source VARCHAR(40) NOT NULL DEFAULT 'ceo_loop',
  error_message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ceo_autopost_queue_user_status ON ceo_autopost_queue(user_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_ceo_autopost_queue_user_created ON ceo_autopost_queue(user_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_ceo_configs_updated_at ON ceo_configs;
CREATE TRIGGER trg_ceo_configs_updated_at
BEFORE UPDATE ON ceo_configs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_ceo_autopost_channels_updated_at ON ceo_autopost_channels;
CREATE TRIGGER trg_ceo_autopost_channels_updated_at
BEFORE UPDATE ON ceo_autopost_channels
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_ceo_autopost_queue_updated_at ON ceo_autopost_queue;
CREATE TRIGGER trg_ceo_autopost_queue_updated_at
BEFORE UPDATE ON ceo_autopost_queue
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
