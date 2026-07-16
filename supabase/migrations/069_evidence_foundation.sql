-- Phase 2: Reusable controlled-document, acknowledgement, evidence, and exception foundation.

CREATE TABLE public.property_applicability (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  facilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  services JSONB NOT NULL DEFAULT '[]'::jsonb,
  brand_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.controlled_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('sop', 'policy', 'training', 'safety', 'certificate')),
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  approval_state TEXT NOT NULL CHECK (approval_state IN ('draft', 'approved', 'superseded', 'archived')) DEFAULT 'draft',
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  effective_date DATE,
  review_date DATE,
  expiration_date DATE,
  applicability JSONB NOT NULL DEFAULT '[]'::jsonb,
  retention_class TEXT NOT NULL CHECK (retention_class IN ('operational_3_years', 'safety_7_years', 'brand_7_years')),
  source_sop_document_id UUID REFERENCES public.sop_documents(id) ON DELETE SET NULL,
  supersedes_id UUID REFERENCES public.controlled_documents(id) ON DELETE RESTRICT,
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, title, version_number)
);

CREATE TABLE public.document_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.controlled_documents(id) ON DELETE RESTRICT,
  assigned_to UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date DATE NOT NULL,
  competency_required BOOLEAN NOT NULL DEFAULT FALSE,
  competency_status TEXT CHECK (competency_status IN ('not_required', 'pending', 'observed', 'passed', 'failed')) DEFAULT 'pending',
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_id, assigned_to)
);

CREATE TABLE public.evidence_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('file', 'photo', 'measurement', 'checklist_result', 'signature', 'attestation', 'external_certificate')),
  document_id UUID REFERENCES public.controlled_documents(id) ON DELETE SET NULL,
  assignment_id UUID REFERENCES public.document_acknowledgements(id) ON DELETE SET NULL,
  related_entity_type TEXT CHECK (related_entity_type IN ('staff', 'task', 'asset', 'room', 'inspection', 'incident', 'sop')),
  related_entity_id UUID,
  measurement_value TEXT,
  result TEXT CHECK (result IN ('passed', 'failed', 'deferred')),
  required_by TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  storage_path TEXT,
  file_name TEXT,
  file_content_type TEXT,
  collected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  collected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_controlled_documents_review ON public.controlled_documents (tenant_id, approval_state, review_date, expiration_date);
CREATE INDEX idx_document_acknowledgements_due ON public.document_acknowledgements (tenant_id, assigned_to, due_date);
CREATE INDEX idx_evidence_records_exception ON public.evidence_records (tenant_id, required_by, expires_at);

ALTER TABLE public.property_applicability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.controlled_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_property_applicability" ON public.property_applicability FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_controlled_documents" ON public.controlled_documents FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_document_acknowledgements" ON public.document_acknowledgements FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_evidence_records" ON public.evidence_records FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

INSERT INTO storage.buckets (id, name, public) VALUES ('evidence-files', 'evidence-files', FALSE) ON CONFLICT (id) DO NOTHING;
CREATE POLICY "tenant_evidence_storage" ON storage.objects FOR ALL USING (
  bucket_id = 'evidence-files' AND (storage.foldername(name))[1] = ((SELECT auth.jwt()) ->> 'hotel_id')
);
