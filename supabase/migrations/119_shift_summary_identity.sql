-- =============================================================================
-- Migration 119: Shift Summary Identity (Phase 5 — Full AI Shift Handoff)
-- Gives shift_summaries a real (tenant_id, shift_id, shift_date) identity, and
-- adds a structured handoff snapshot + a trustworthy generation timestamp.
--
-- Before this migration, shift_id + shift_date had no uniqueness guarantee at
-- all — a double-click of "Generate" or an overlapping cron run could insert
-- a second row for the exact same shift/date, and GET /shift-summary/{shift_id}
-- had no way to disambiguate which row it meant. This migration deterministically
-- consolidates any such duplicates before adding the constraint so it can never
-- fail to apply, and never silently drops an operator's acknowledgment.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: carry any acknowledgment among duplicates onto the row that will
-- survive, before the duplicates are removed. Only touches the earliest
-- acknowledgment per (tenant_id, shift_id, shift_date) group, and only when
-- the survivor doesn't already have one.
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT id, tenant_id, shift_id, shift_date,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, shift_id, shift_date
           ORDER BY generated_at DESC, id DESC
         ) AS rn
  FROM public.shift_summaries
),
survivors AS (
  SELECT id, tenant_id, shift_id, shift_date FROM ranked WHERE rn = 1
),
ack_donor AS (
  SELECT DISTINCT ON (tenant_id, shift_id, shift_date)
         tenant_id, shift_id, shift_date, acknowledged_by, acknowledged_at
  FROM public.shift_summaries
  WHERE acknowledged_at IS NOT NULL
  ORDER BY tenant_id, shift_id, shift_date, acknowledged_at ASC
)
UPDATE public.shift_summaries s
SET acknowledged_by = ack_donor.acknowledged_by,
    acknowledged_at = ack_donor.acknowledged_at
FROM survivors, ack_donor
WHERE s.id = survivors.id
  AND survivors.tenant_id = ack_donor.tenant_id
  AND survivors.shift_id = ack_donor.shift_id
  AND survivors.shift_date = ack_donor.shift_date
  AND s.acknowledged_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 2: remove true duplicates, keeping the freshest (generated_at DESC)
-- row per (tenant_id, shift_id, shift_date). Rows from different dates or
-- different shifts are never touched.
-- ---------------------------------------------------------------------------
DELETE FROM public.shift_summaries
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY tenant_id, shift_id, shift_date
      ORDER BY generated_at DESC, id DESC
    ) AS rn
    FROM public.shift_summaries
  ) ranked
  WHERE rn > 1
);

-- ---------------------------------------------------------------------------
-- Step 3: structured handoff snapshot + a real "last generated/updated" pair.
-- generated_at already exists (set at INSERT, migration 012) but a Regenerate
-- must be able to bump the effective generation time without losing the
-- original semantics elsewhere relying on it, so both columns are kept:
-- generated_at = last time the AI actually ran, updated_at = last row write.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shift_summaries
  ADD COLUMN handoff_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ---------------------------------------------------------------------------
-- Step 4: the uniqueness guarantee itself. Enables a safe upsert on
-- (tenant_id, shift_id, shift_date) for Generate/Regenerate, and makes
-- GET /shift-summary/{shift_id}?shift_date=... a deterministic lookup.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shift_summaries
  ADD CONSTRAINT shift_summaries_tenant_shift_date_unique UNIQUE (tenant_id, shift_id, shift_date);

COMMENT ON COLUMN public.shift_summaries.handoff_data IS
  'Structured snapshot captured at generation time (tasks_completed, open_work_orders, guest_issues, vip_arrivals, low_stock_parts, sla_breaches, follow_ups) — the Shift Handoff drawer renders its detail sections from this, never from re-querying live data, so historical handoffs stay historical. Empty {} for rows generated before Phase 5.';
COMMENT ON COLUMN public.shift_summaries.updated_at IS
  'Last write to this row (set on both insert and regenerate). generated_at reflects the last time the AI itself actually ran.';
COMMENT ON CONSTRAINT shift_summaries_tenant_shift_date_unique ON public.shift_summaries IS
  'A shift occurrence has exactly one handoff summary. Regenerate upserts this row in place instead of inserting a duplicate.';
