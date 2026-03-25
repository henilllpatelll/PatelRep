# PatelRep Repository Cleanup — Design Spec

**Date:** 2026-03-24
**Scope:** Full top-to-bottom structural cleanup of the PatelRep monorepo
**Approach:** Approach C — Aggressive. Delete junk, fix structural bugs, consolidate duplicates, no backward-compat shims.

---

## Problem Summary

The repo has accumulated structural issues from Windows file system artifacts, abandoned experiments, and iterative development without cleanup:

1. Ghost directories from Windows parenthesis-split bug
2. Duplicate `.vercel/` project configs
3. Untracked files that should be committed (`CLAUDE.md`)
4. Stale docs that duplicate better sources
5. Empty directories that imply intent but have no content
6. `.playwright-mcp/` browser session files not gitignored
7. `lib/utils.ts` + `lib/utils/` directory name collision
8. No-op layout files in route groups
9. Root `.ruff_cache/` duplicating `apps/api/.ruff_cache/`

---

## Deletions

### Root Level
| Path | Reason |
|------|--------|
| `LAUNCH_GUIDE.md` | App is already deployed; historical artifact |
| `REMAINING_WORK.md` | Redundant with `CLAUDE.md` + `.planning/STATE.md` |
| `.playwright-mcp/` | Browser test session logs/screenshots, not gitignored |
| `.ruff_cache/` | Duplicate of `apps/api/.ruff_cache/` |
| `.superpowers/` | Brainstorm session artifacts (gitignored, stale) |
| `.worktrees/design-overhaul` | Old worktree (gitignored, stale) |
| `.vercel/` (root) | Duplicate stale artifact from an earlier `vercel link` run in the wrong CWD; `apps/web/.vercel/` is the canonical config |

### Ghost Directories (Windows parenthesis-split bug)
Each contains only a lone `)` subdirectory — completely inert.
| Path |
|------|
| `apps/mobile/app/(app` |
| `apps/mobile/app/(auth` |
| `apps/web/app/(auth` |
| `apps/web/app/(dashboard` |

### Empty Directories
| Path | Reason |
|------|--------|
| `apps/api/services/billing/` | Never implemented, no files |
| `apps/web/types/` | Empty, nothing referencing it |
| `apps/web/public/.gitkeep` | Placeholder file; dir kept, file removed |

### Stale Docs
| Path | Reason |
|------|--------|
| `docs/superpowers/HANDOFF.md` | Session artifact from 2026-03-19, stale |
| `docs/superpowers/specs/2026-03-14-patelrep-design-overhaul.md` | Superseded by Mar 19 redesign |
| `docs/superpowers/plans/2026-03-14-design-overhaul.md` | Superseded by Mar 19 redesign |

### No-op Files
| Path | Reason |
|------|--------|
| `apps/web/app/(auth)/_layout.tsx` | Underscore-prefixed — Next.js App Router never treated it as a real layout. Dead file, zero routing impact. |

---

## Fixes

### 1. Consolidate `lib/utils.ts` + `lib/utils/`
**Problem:** `apps/web/lib/utils.ts` exports `cn()`. `apps/web/lib/utils/` directory exports `avatar.ts` and `roomStatus.ts`. A file and directory share the same name — TypeScript/bundler ambiguity. When both exist, the file wins; after deletion the directory index takes over.

**Fix (order matters — do atomically):**
1. Create `lib/utils/index.ts` exporting `cn()` (while `utils.ts` still exists)
2. Delete `lib/utils.ts`
- `lib/utils/avatar.ts` and `lib/utils/roomStatus.ts` unchanged

**All files importing `@/lib/utils` (no path changes needed — `index.ts` resolves automatically):**
- `components/housekeeping/RoomCard.tsx`
- `components/housekeeping/RoomStatusBoard.tsx`
- `components/shared/Sidebar.tsx`
- `components/shared/Header.tsx`
- `components/ui/Badge.tsx`
- `components/ui/Button.tsx`
- `components/ui/Card.tsx`
- `components/ui/Input.tsx`
- `components/ui/Skeleton.tsx`
- `app/(dashboard)/housekeeping/rooms/page.tsx`

### 2. Fix `.gitignore`
Add missing entries:
```
# Playwright MCP browser sessions
.playwright-mcp/

# Python ruff cache (project root)
.ruff_cache/
```

### 3. Commit `.claude/`
The `.claude/` directory (untracked) contains project-specific AI skill files (`skills/patelrep-api/`, `skills/patelrep-mobile/`, `skills/patelrep-web/`) referenced in `CLAUDE.md`. Commit it — it's part of the project's AI workflow infrastructure, not a personal tool.

### 4. Commit `CLAUDE.md`
Currently untracked. Must be committed — it's the AI session instruction file read at every session start.

### 5. Commit `.planning/config.json`
Trivial trailing-comma fix, currently modified/unstaged.

### 6. Create `README.md`
Replace the deleted `LAUNCH_GUIDE.md` and `REMAINING_WORK.md` with a single minimal README at root:
- What the project is (1 paragraph)
- Monorepo structure (tree)
- How to run each app locally
- Links to `spec/` and `CLAUDE.md`

---

## Out of Scope

- No changes to API router logic or business code
- No changes to Supabase migrations
- No changes to mobile app screens
- No changes to web dashboard pages
- `docs/superpowers/plans/2026-03-19-lobby-ui-redesign.md` and `docs/superpowers/specs/2026-03-19-ui-redesign-design.md` kept (most recent, potentially in-progress)
- `.planning/` GSD workflow files untouched

---

## Success Criteria

- `git status` shows only intentional tracked files
- No ghost directories in `apps/mobile/app/` or `apps/web/app/`
- `apps/web/lib/utils.ts` does not exist; `apps/web/lib/utils/index.ts` exists and exports `cn()`
- `.playwright-mcp/` and `.ruff_cache/` are in `.gitignore`
- `CLAUDE.md` is committed
- `README.md` exists at root
- Web build (`npm run build --workspace=@patelrep/web`) passes
