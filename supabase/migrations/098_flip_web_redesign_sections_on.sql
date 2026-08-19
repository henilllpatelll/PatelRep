-- 37-05 checkpoint resolved by user 2026-08-19: include every tenant (the 9
-- is_test=true QA/dev tenants and the 1 regression-fixture system tenant too),
-- not just the one real tenant -- matches Success Criterion 4's literal
-- wording ("flipped on for all sections with no half-old/half-new state
-- remaining").

UPDATE public.tenants
SET web_redesign_sections = ARRAY[
  'shell','dashboard','tasks','evidence','engineering','reports','managementRoi',
  'aiCopilot','logbook','staff','lostFound','programs','sop','scheduling','safety',
  'guestRequests','billing','settings','guestFeedback','integrations','housekeeping'
]
WHERE NOT (web_redesign_sections @> ARRAY[
  'shell','dashboard','tasks','evidence','engineering','reports','managementRoi',
  'aiCopilot','logbook','staff','lostFound','programs','sop','scheduling','safety',
  'guestRequests','billing','settings','guestFeedback','integrations','housekeeping'
]);

ALTER TABLE public.tenants
  ALTER COLUMN web_redesign_sections SET DEFAULT ARRAY[
    'shell','dashboard','tasks','evidence','engineering','reports','managementRoi',
    'aiCopilot','logbook','staff','lostFound','programs','sop','scheduling','safety',
    'guestRequests','billing','settings','guestFeedback','integrations','housekeeping'
  ];

COMMENT ON COLUMN public.tenants.web_redesign_sections IS
  'Per-section v2.0 redesign rollout gate. v2.0 fully rolled out as of migration 098 -- all
   tenants read all 21 sections as redesigned by default. Empty/partial arrays remain
   supported for any tenant that legitimately needs a legacy/partial view (e.g. the FOUND-03
   regression fixture tenant). Removed entirely in the v2.0 cleanup once the gate mechanism
   itself is deleted (see 097''s original comment).';

-- ROLLBACK:
-- UPDATE public.tenants SET web_redesign_sections = '{}';
-- ALTER TABLE public.tenants ALTER COLUMN web_redesign_sections SET DEFAULT '{}';
