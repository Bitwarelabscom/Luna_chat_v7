-- Purge speculative/interpretive facts that aren't concrete
-- These are LLM-generated analyses, not actual user facts
DELETE FROM user_facts
WHERE fact_value ~* '\y(suggests|implies|may reflect|might indicate|deeper desire|self-identification|hypothesis|assumption|further validation|based on assumptions)\y'
  AND fact_status = 'active';

-- Purge emotional moments with hallucination markers
-- Targets clearly embellished crystallizations that add details not in the original
DELETE FROM emotional_moments
WHERE moment_tag ~* '\y(incredible|fantastic|amazing|wonderful|exciting features|just received)\y'
  AND created_at < NOW() - INTERVAL '1 day';
