// Developer Harness V2 — Phase 3 curated-memory topic taxonomy (data only).
//
// Topics are assigned deterministically by weighted keyword scoring (highest score wins; ties go to the earlier
// topic in TOPICS order; no match falls back to `architecture`). Preference entries always go to
// `user-preferences`. The same ids are referenced by context packs (context-packs.mjs).

export const TOPICS = Object.freeze([
  { id: 'agent-harness', title: 'Customer Agent Harness (H0–H7)', file: 'agent-harness.md',
    summary: 'Customer-facing agent runtime, tool gateway, identity, autonomy and billing (NOT the developer harness).' },
  { id: 'database-migrations', title: 'Database, migrations and RLS', file: 'database-migrations.md',
    summary: 'Supabase/Postgres schema, migration safety, RLS, grants, SQL/PLpgSQL gotchas.' },
  { id: 'ci-staging-release', title: 'CI, Staging and release', file: 'ci-staging-release.md',
    summary: 'GitHub Actions, CI Gate, Staging, Release Engineer, deploy targets, baselines.' },
  { id: 'mobile', title: 'Mobile (Expo / React Native)', file: 'mobile.md',
    summary: 'apps/mobile screens, Expo/RN, jest/RNTL, offline queues, device verification.' },
  { id: 'web', title: 'Web (Next.js)', file: 'web.md',
    summary: 'apps/web pages and components, Next.js, React Query, web tests.' },
  { id: 'api-supabase', title: 'API (FastAPI) and Supabase access', file: 'api-supabase.md',
    summary: 'apps/api routers, services, pytest/fakes, RBAC matrix, Supabase SDK usage.' },
  { id: 'developer-workflow', title: 'Developer workflow and tooling', file: 'developer-workflow.md',
    summary: 'Git/worktrees, Bash/Edit tool gotchas, Windows encoding, test running, PR process.' },
  { id: 'architecture', title: 'Product architecture and domain', file: 'architecture.md',
    summary: 'Cross-cutting product/domain decisions (tenancy, realtime, housekeeping, engineering, AI).' },
  { id: 'user-preferences', title: 'User preferences', file: 'user-preferences.md',
    summary: 'Explicit owner preferences on scope, process and communication.' },
])

export const TOPIC_IDS = Object.freeze(TOPICS.map((t) => t.id))

/** [regex, weight] per topic. Regexes are case-insensitive and matched against the entry text. */
export const TOPIC_RULES = Object.freeze({
  'agent-harness': [[/agent[ -]harness/i, 4], [/\bH[0-7]\b(?! ?P\d)/, 3], [/\bH7 ?P2\b/i, 3], [/decide_v2|tool gateway|provider[- ]spend|agent_tool_|agent_runs?\b|autonomy grant|IdentityAuthority/i, 4], [/\bagent\b/i, 1]],
  'database-migrations': [[/supabase\/migrations|\bmigrations?\b/i, 3], [/\bRLS\b|row level security|policy\b.*\bTO (public|authenticated)/i, 3], [/SECURITY DEFINER|\bGRANT\b|REVOKE|plpgsql|PL\/pgSQL|\bjsonb\b|CHECK constraint|\bCHECK\b|trigger\b|\bSQL\b|postgres|pg_|\bFK\b|foreign key|index(es)?\b/i, 2], [/staging-reviewed|reviewed preview|destructive-reviewed|rollback-plan/i, 3]],
  'ci-staging-release': [[/\.github\/workflows|GitHub Actions|\bworkflows?\b/i, 3], [/\bCI\b|CI Gate|Staging (Gate|Candidate)|\bstaging\b/i, 2], [/Release Engineer|production release|rollback|deploy|Railway|Vercel|\bEAS\b|baseline|Dependabot|check runs?/i, 2]],
  mobile: [[/apps\/mobile/i, 4], [/\bExpo\b|React Native|\bRN\b|RNTL|jest-native|FlatList|expo-router|Metro|Android|\biOS\b|emulator|bottom ?sheet|\bOTA\b/i, 3], [/\bmobile\b|housekeeper app|phone/i, 2]],
  web: [[/apps\/web/i, 4], [/Next\.js|\bnext (dev|build)\b|React Query|Tailwind|shadcn|Playwright|\bdashboard\b|drawer|App Router/i, 2], [/\bweb\b/i, 2]],
  'api-supabase': [[/apps\/api/i, 4], [/FastAPI|pytest|pydantic|\brouters?\/|routers\b|RBAC-MATRIX|fake_supabase|FakeDB|endpoint|uvicorn|ruff|pyright|\.venv/i, 3], [/\bAPI\b|PostgREST|PGRST|supabase-py|\.eq\(/i, 2]],
  'developer-workflow': [[/Bash tool|heredoc|Edit tool|Write tool|PowerShell|Git Bash|CRLF|newline=|encoding=|core\.autocrlf/i, 4], [/\bworktree|git (stash|rebase|push|diff)|\bbranch\b|\bPR\b|pull request|commit\b|GSD|OpenWolf|buglog|cerebrum|anatomy/i, 2], [/\bWindows\b|\bnpm (ci|install)\b|node_modules|junction|ripgrep/i, 2]],
  architecture: [[/tenant|multi-tenan|realtime|domain\b|housekeeping|engineering|work orders?|room status|assignment|inspection|guest request|AI\b|credits?/i, 1]],
})

export const KINDS = Object.freeze(['dnr', 'preference', 'decision', 'learning', 'history', 'note'])

export const KIND_SECTION = Object.freeze({
  dnr: 'Do-Not-Repeat',
  preference: 'Preferences',
  learning: 'Conventions and learnings',
  decision: 'Decisions (historical record)',
  history: 'Feature and phase notes (historical record)',
  note: 'Other notes',
})

/** Per-file size cap for generated knowledge files (bytes). Larger topics are split into numbered parts. */
export const KNOWLEDGE_FILE_CAP_BYTES = 48_000

/** Conservative character-per-token ratio used ONLY for ESTIMATED token figures (no tokenizer is installed). */
export const ESTIMATE_CHARS_PER_TOKEN = 3.5
export const estimateTokens = (text) => Math.ceil(String(text).length / ESTIMATE_CHARS_PER_TOKEN)
