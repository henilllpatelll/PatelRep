-- Open question deliberately left unresolved by this migration, for the 37-05 checkpoint:
-- Should the 9 is_test=true QA/dev tenants and the 1 regression-fixture system tenant
-- (a0000000-0000-4000-a000-000000000001) be INCLUDED in this unconditional flip (current
-- shape below: yes, since the WHERE clause has no is_test exclusion), or explicitly EXCLUDED
-- (documented alternative: add "AND is_test = false AND id != 'a0000000-0000-4000-a000-000000000001'"
-- to the WHERE clause)? This is a genuine judgment call flagged by both CONTEXT.md and
-- RESEARCH.md as unresolved -- not something to decide silently here.

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
