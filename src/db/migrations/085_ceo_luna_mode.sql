-- Migration: 085_ceo_luna_mode.sql
-- Description: Add CEO Luna chat mode to sessions.mode constraint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'sessions'
      AND c.conname = 'sessions_mode_check'
  ) THEN
    ALTER TABLE sessions DROP CONSTRAINT sessions_mode_check;
  END IF;
END $$;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_mode_check
  CHECK (
    (mode)::text = ANY (
      (
        ARRAY[
          'assistant'::character varying,
          'companion'::character varying,
          'voice'::character varying,
          'dj_luna'::character varying,
          'ceo_luna'::character varying
        ]
      )::text[]
    )
  );
