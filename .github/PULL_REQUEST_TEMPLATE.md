## What changed?

## Why?

## Strategy fit

<!-- Strategy Fit Record: docs/patelrep-strategy/14-development-and-acceptance-standards.md §3.2.
     Keep it proportionate: one line per field, or "n/a, because ...". Never invent measurements or customer
     outcomes; write NOT MEASURED when there is no measurement. Not checked by CI. -->

- Change type (product / bug fix / security patch / dependency update / documentation / infrastructure maintenance):
- Abbreviated justification (non-product changes only; then skip the product fields):

Product changes (features, agents, metrics, predictions, workflows, integrations, automation):

- Customer problem:
- Roles that benefit:
- Roadmap workstream (W1–W16):
- Intended measurable outcome (metric and evidence class, or NOT MEASURED):
- Data and integration dependencies:
- Missing-data and fallback behavior:
- Employee protection and quality:
- Security and authorization:
- Cost implications:
- Validation, rollout and rollback:

## Affected areas

## Verification

- Automated tests/checks run:
- Manual verification performed:

## Data, rollout, and safety

- [ ] No Supabase/database migration is included.
- [ ] A Supabase/database migration is included (list migration number(s) below).
- Migration number(s), if applicable:
- [ ] This change is backward compatible.
- [ ] This migration follows expand → migrate → contract where application-visible schema changes are involved.
- [ ] This migration contains destructive SQL (if checked, add the required safety marker and review details below).
- Backfill required and idempotency/tenant/locking plan:
- Clean rebuild verified locally or by CI:
- Staging migration and `/ready` verification:
- Rollback or forward-fix strategy for the migration:
- Feature flag / rollout plan, if relevant:
- Rollback approach:
- Existing hotel workflows that could be affected:

## Scope confirmation

- [ ] I did not intentionally modify unrelated behavior.
