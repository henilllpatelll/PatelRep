ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON public.custom_roles
  FOR ALL USING (hotel_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid);

ALTER TABLE public.staff_role_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON public.staff_role_schedules
  FOR ALL USING (hotel_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid);
