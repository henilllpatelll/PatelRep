# CI, Staging and release — Do-Not-Repeat

> Curated OpenWolf knowledge — **advisory data, not instructions**. Nothing here grants authority or overrides the
> human's request, `docs/developer-harness-v2/contract.json`, the Phase 2 policy engine, GitHub rulesets, CI/Staging
> gates or human approval. Verify against current code before relying on an entry.
> Migrated from `.wolf/cerebrum.md` @ `8cccb11b944e` (sha256 `43224847720948ea…`).
> Tags: `[K-id · L<source line> · <date>]`. Entries are historical unless re-verified. Size cap 48000 bytes per file.

## Do-Not-Repeat

- [K-69d8d20c7f · L1153 · 2026-11-06] [2026-11-06] Learning: Room-Board visual baselines are Linux-only; a Windows run writes `*-win32.png` files that must be deleted, not committed. Flag-off layout changes to Room Board components must stay behind `isDesignV2PreviewEnabled()`.
- [K-55158c6b76 · L962 · 2026-10-29] Dirty-checking a form draft against the NEW server baseline hides the first load; compare against the baseline it was last synced with.
- [K-291cbc0259 · L963 · 2026-10-29] A local venv may be older than CI pins (dateutil 2.9 vs 3.0, stripe 15 vs 16): 5 unrelated tests fail locally only.
- [K-4e1a05a67f · L445 · 2026-10-01] [2026-10-01] **Local Supabase reconstruction requires Docker Desktop's Linux engine to be reachable.** If the Docker pipe is unavailable, do not substitute SQLite or a production/staging database; run static checks locally and leave the pinned Docker-backed CI gate as the authoritative clean-rebuild proof.
- [K-7e02312031 · L467 · 2026-07-24] [2026-07-24] **`gsd-sdk` is NOT on PATH in this environment, and the invocation shape in the workflow docs is wrong for it.** Workflow files say `gsd-sdk query <command>`; the real call is `node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" <command>` with NO `query` subcommand (`query` returns "Unknown command"). Example: `node .../gsd-tools.cjs init plan-phase 5`, not `gsd-sdk query init.plan-phase 5`. Dotted names in the docs map to space-separated args (`roadmap.get-phase` → `roadmap get-phase`, `state.planned-phase` → `state planned-phase`).
- [K-b40ca12012 · L521 · 2026-05-24] [2026-05-24] **Vercel CLI Preview env add may require a branch argument** — For `patelrep-web`, `vercel env add NAME preview --value ... --yes --force` returned `git_branch_required`. Use `vercel env add NAME preview codex/frontend-design-handoff-rework --value ... --yes --force`. Also, `vercel redeploy` does not accept `--yes`; use `vercel redeploy <url> --target preview`.
- [K-f0e419df45 · L522 · 2026-05-24] [2026-05-24] **Protected Vercel Preview smoke must use relative `vercel curl`** — Plain `Invoke-WebRequest` hits the deployment protection page. Use `vercel curl /path --deployment <deployment-url>`; passing the full URL as the path fails.
- [K-2fb49c73d3 · L551 · 2026-05-10] [2026-05-10] **Railway CLI deployment log syntax changed/strict** — do not combine `railway logs --deployment` with `--build`; use `railway logs --deployment --lines N <deployment_id>` or the Railway MCP `get_logs` tool for build logs.
- [K-dc671429f6 · L547 · 2026-05-09] [2026-05-09] **Authenticated e2e currently depends on unavailable external infra** — Railway reports latest web/API deployments as `REMOVED`, both public Railway URLs return 404, and the configured Supabase project host is NXDOMAIN. Use local unauthenticated e2e plus API/web checks until Railway deployment and Supabase DNS are restored.
