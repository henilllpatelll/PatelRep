-- Minimal stand-in for the production schema, for the DISPOSABLE Postgres used by test_pm_foundation_sql.py.
-- It carries only the columns, constraints and triggers that migration 232's functions touch, copied from migrations
-- 008, 065, 071, 101 and 115. It is NOT a replacement for the CI migration replay (supabase db reset --local), which
-- applies every real migration; it exists so the two functions can be exercised, including concurrently, without one.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE TABLE public.tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

CREATE TABLE public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL, asset_tag text, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.pm_checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL, program_area text NOT NULL, name text NOT NULL, version integer NOT NULL DEFAULT 1,
  items jsonb NOT NULL DEFAULT '[]', is_active boolean NOT NULL DEFAULT true, UNIQUE (tenant_id, code, version));
CREATE TABLE public.pm_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE, name text NOT NULL,
  interval_type text NOT NULL, interval_days int, estimated_minutes int NOT NULL DEFAULT 30, assigned_to_role text,
  last_completed_at timestamptz, next_due_at timestamptz NOT NULL, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  recurrence_basis text NOT NULL DEFAULT 'scheduled_date' CHECK (recurrence_basis IN ('scheduled_date', 'completion_date')));

CREATE TABLE public.work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  asset_id uuid, title text NOT NULL, description text, category text, priority text, created_by uuid,
  is_pm_generated boolean NOT NULL DEFAULT false, pm_completion_id uuid, sla_minutes int, due_at timestamptz,
  status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.evidence_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  related_entity_type text, related_entity_id uuid);
CREATE TABLE public.operational_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resource_type text NOT NULL, resource_id uuid NOT NULL, action text NOT NULL, actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text NOT NULL, old_state jsonb NOT NULL DEFAULT '{}', new_state jsonb NOT NULL DEFAULT '{}', reason_code text,
  reason_note text, source text NOT NULL CHECK (source IN ('web', 'mobile', 'api', 'automation')), created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.pm_completion_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pm_schedule_id uuid NOT NULL REFERENCES public.pm_schedules(id) ON DELETE RESTRICT, asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  checklist_template_id uuid REFERENCES public.pm_checklist_templates(id) ON DELETE SET NULL, checklist_version integer,
  technician_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT, verifier_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  measurements jsonb NOT NULL DEFAULT '{}', meter_readings jsonb NOT NULL DEFAULT '{}', photos jsonb NOT NULL DEFAULT '[]',
  labor_minutes integer NOT NULL DEFAULT 0 CHECK (labor_minutes >= 0), parts_used jsonb NOT NULL DEFAULT '[]',
  defects jsonb NOT NULL DEFAULT '[]', vendor_name text, vendor_id uuid, certificate_attachments jsonb NOT NULL DEFAULT '[]',
  notes text, completed_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.pm_completion_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  completion_id uuid NOT NULL REFERENCES public.pm_completion_records(id) ON DELETE RESTRICT, item_key text NOT NULL, label text NOT NULL,
  result text NOT NULL CHECK (result IN ('passed', 'failed', 'not_applicable')), requires_evidence boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '[]', note text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.pm_deferrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pm_schedule_id uuid NOT NULL REFERENCES public.pm_schedules(id) ON DELETE RESTRICT, reason text NOT NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT, approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  deferred_until timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE OR REPLACE FUNCTION public.reject_operational_program_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Operational program records are append-only; add a new event or completion record instead.'; END; $$;
CREATE TRIGGER pm_completion_records_immutable BEFORE UPDATE OR DELETE ON public.pm_completion_records FOR EACH ROW EXECUTE FUNCTION public.reject_operational_program_mutation();
CREATE TRIGGER pm_completion_items_immutable BEFORE UPDATE OR DELETE ON public.pm_completion_items FOR EACH ROW EXECUTE FUNCTION public.reject_operational_program_mutation();
CREATE TRIGGER pm_deferrals_immutable BEFORE UPDATE OR DELETE ON public.pm_deferrals FOR EACH ROW EXECUTE FUNCTION public.reject_operational_program_mutation();
