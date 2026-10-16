-- migration-safety: destructive-reviewed
-- rollback-plan: Re-add the previous CHECK (migration 215 value list without 'translation') after confirming no ai_interactions rows use translation, then DROP TABLE ai_content_translations (a cache only; every translation can be regenerated and no original text is stored there). The only DROP replaces this migration's own constraint with a superset of allowed values.
-- =============================================================================
-- Migration 216: AI instruction translation (task instructions) + usage type
-- =============================================================================
-- Phase 5 of Mobile Housekeeper AI V2. Two additive changes, nothing historical is edited:
--
-- 1. ai_interactions.interaction_type gains 'translation' so a paid task-instruction translation is
--    logged with its real token usage. Mirrors migrations 091 / 099 / 100 / 215: drop and re-add the
--    CHECK with every previously allowed value kept.
-- 2. ai_content_translations caches a translation per tenant + source record + SOURCE TEXT HASH +
--    target language. The hash is part of the key, so an edited task simply misses the cache and the
--    stale translation is never served; it is also never read before the caller was authorised for the
--    source record (the API checks access first). The original text is never modified.
-- =============================================================================

ALTER TABLE ai_interactions DROP CONSTRAINT IF EXISTS ai_interactions_interaction_type_check;

ALTER TABLE ai_interactions ADD CONSTRAINT ai_interactions_interaction_type_check CHECK (
  interaction_type IN (
    'task_creation',
    'room_prediction',
    'sop_query',
    'failure_prediction',
    'shift_summary',
    'gm_insight',
    'assignment_suggestion',
    'onboarding_assistant',
    'work_order_triage',
    'work_order_creation',
    'guest_request_creation',
    'task_assignment',
    'general',
    'housekeeping_briefing',
    'supervisor_briefing',
    'engineer_briefing',
    'front_desk_briefing',
    'gm_briefing',
    'housekeeper_shift_recap',
    'photo_analysis',
    'translation'
  )
);

CREATE TABLE IF NOT EXISTS ai_content_translations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_type      TEXT        NOT NULL CHECK (source_type IN ('task')),
  source_id        UUID        NOT NULL,
  source_hash      TEXT        NOT NULL CHECK (char_length(source_hash) BETWEEN 16 AND 128),
  target_language  TEXT        NOT NULL CHECK (target_language IN ('en', 'es')),
  translated_title TEXT        NOT NULL,
  translated_body  TEXT,
  provider         TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, source_type, source_id, source_hash, target_language)
);

COMMENT ON TABLE ai_content_translations IS
  'AI translations of hotel records (task instructions). Keyed by a hash of the source text so edits invalidate them; never a replacement for the original.';

ALTER TABLE ai_content_translations ENABLE ROW LEVEL SECURITY;

-- Same tenant-isolation shape as migration 069 (evidence) / 037 (initplan-safe auth.jwt()).
CREATE POLICY "tenant_ai_content_translations" ON ai_content_translations
  FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_ai_content_translations_tenant
  ON ai_content_translations (tenant_id, source_type, source_id);
