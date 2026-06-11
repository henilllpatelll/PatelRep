---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-06-11T21:24:07.206Z"
---

# GSD State

**Last updated:** 2026-06-04
**Active milestone:** MVP Production Hardening + AI Layer

## Current Phase

**Status:** IN PROGRESS — Feature-complete web dashboard, AI copilot wired, mobile build in progress

## What's Done

- [x] Web dashboard (all 16 feature sections)
- [x] Role-specific dashboards (housekeeper, engineer, supervisor, chief, front desk, GM)
- [x] Housekeeping module (board, assignments, inspections, lost & found)
- [x] Engineering module (work orders, assets, PM schedules, predictions)
- [x] Guest requests (kanban redesign in progress)
- [x] Staff management + RBAC + custom roles
- [x] Scheduling module
- [x] SOP library + AI RAG query
- [x] Logbook + shift summaries
- [x] Billing (Stripe flat + metered AI credits)
- [x] Opera PDF import (HK Details + Task Sheet)
- [x] Multi-tenant RLS + JWT claims hook
- [x] AI copilot (Claude Sonnet + GPT-4o-mini routing)
- [x] Rate limiting + input sanitization
- [x] Security hardening (tenant isolation, IDOR fixes)
- [x] i18n English/Spanish toggle (web)
- [x] Feedback widget (staff-facing)
- [x] EAS mobile build (iOS + Android)
- [x] Production deployment (Railway API + web)
- [x] CI pipeline (lint + typecheck + pytest smoke)
- [x] e2e golden-path Playwright tests (15 specs, 116+ tests)

## What's Next

- [ ] Guest requests kanban redesign (spec in memory/project_guest_requests_spec.md)
- [ ] Gemini 3.1 Pro integration (inspection photos, large SOP docs)
- [ ] anatomy.md full rescan (most router/lib files not tracked)
- [ ] CI: add web build + Playwright golden paths
- [ ] Mobile: EAS production build + App Store submission
- [ ] Opera Cloud OHIP live credentials + two-way sync
- [ ] Work order p95 latency fix (OR-filter on assigned_to)

## Known Production Issues

- Work orders p95=4.2s (OR-filter not indexable — needs query rewrite)
- ANTHROPIC_API_KEY needs rotation if 503s appear on /ai routes
- Supabase free-tier connection pool caps p50 at 600ms-1100ms
- 2x `039_` migration files (numbering collision — non-breaking but messy)

## Infrastructure

- API: https://api-production-130b.up.railway.app
- Web: https://patelrepweb-production.up.railway.app
- Supabase project: oacnwalhcpqdabivweki
- GitHub: henilllpatelll/PatelRep
