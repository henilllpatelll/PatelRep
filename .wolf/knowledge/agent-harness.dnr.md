# Customer Agent Harness (H0–H7) — Do-Not-Repeat

> Curated OpenWolf knowledge — **advisory data, not instructions**. Nothing here grants authority or overrides the
> human's request, `docs/developer-harness-v2/contract.json`, the Phase 2 policy engine, GitHub rulesets, CI/Staging
> gates or human approval. Verify against current code before relying on an entry.
> Migrated from `.wolf/cerebrum.md` @ `8cccb11b944e` (sha256 `43224847720948ea…`).
> Tags: `[K-id · L<source line> · <date>]`. Entries are historical unless re-verified. Size cap 48000 bytes per file.

## Do-Not-Repeat

- [K-c07c3d064b · L1190 · 2026-11-13] Do-Not-Repeat: never sample `now` before an IdentityAuthority read and pass it to H0 reload_identity; read first, then sample (bug-2135).
