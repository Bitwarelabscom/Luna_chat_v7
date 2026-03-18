-- Luna Cognitive Upgrades - Phase 4: Self-Modification with Guardrails
-- Migration 116: Style parameters + adjustment audit trail

CREATE TABLE IF NOT EXISTS luna_style_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  param_name VARCHAR(64) NOT NULL,
  current_value REAL NOT NULL DEFAULT 0.5,
  baseline REAL NOT NULL DEFAULT 0.5,
  min_value REAL NOT NULL DEFAULT 0.0,
  max_value REAL NOT NULL DEFAULT 1.0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, param_name)
);

CREATE TABLE IF NOT EXISTS luna_self_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  observation TEXT NOT NULL,
  param_name VARCHAR(64) NOT NULL,
  old_value REAL NOT NULL,
  new_value REAL NOT NULL,
  magnitude REAL NOT NULL,
  approved BOOLEAN NOT NULL DEFAULT false,
  applied BOOLEAN NOT NULL DEFAULT false,
  reverted BOOLEAN NOT NULL DEFAULT false,
  revert_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_luna_style_params_user
  ON luna_style_parameters (user_id);

CREATE INDEX IF NOT EXISTS idx_luna_adjustments_user_created
  ON luna_self_adjustments (user_id, created_at DESC);
