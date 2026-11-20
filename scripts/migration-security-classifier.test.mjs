import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

import { DESTRUCTIVE_PATTERN, sha256 } from './check-migrations.mjs'
import {
  AUTH_HELPER_FUNCTIONS,
  isSecuritySensitive,
  securitySensitiveReasons,
  stripSqlComments,
} from './migration-security-classifier.mjs'
import { assertPendingPolicy, planStagingMigrations } from './staging-migration-plan.mjs'
import { PRIVILEGED_STAGING_FILES } from './staging-trusted-control-plane.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const reasons = securitySensitiveReasons

// ---------------------------------------------------------------- the classifier
const DEFINER = [
  'CREATE FUNCTION f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ select 1 $$;',
  'create or replace function f() returns int language sql security definer as $$ select 1 $$;',
  'CREATE FUNCTION f() RETURNS int LANGUAGE sql SeCuRiTy\tDeFiNeR AS $$ select 1 $$;',
  'CREATE FUNCTION f() RETURNS int LANGUAGE sql SECURITY\n\n   DEFINER AS $$ select 1 $$;',
  'CREATE FUNCTION f() RETURNS int SECURITY/* hidden */DEFINER AS $$ select 1 $$;',
  'CREATE FUNCTION f() RETURNS int SECURITY /* a /* nested */ comment */ DEFINER AS $$ select 1 $$;',
  'CREATE FUNCTION f() RETURNS int SECURITY -- split\nDEFINER AS $$ select 1 $$;',
  'ALTER FUNCTION public.f() SECURITY DEFINER;',
  "DO $$ BEGIN EXECUTE 'CREATE FUNCTION x() RETURNS int LANGUAGE sql SECURITY ' || 'DEFINER AS $b$ select 1 $b$'; END $$;",
  'DO $outer$ BEGIN EXECUTE $q$ CREATE FUNCTION x() RETURNS int LANGUAGE sql SECURITY DEFINER AS $i$ select 1 $i$ $q$; END $outer$;',
  "DO $$ BEGIN EXECUTE format('CREATE FUNCTION %I() RETURNS int LANGUAGE sql %s AS ''select 1''', 'x', 'SECURITY DEFINER'); END $$;",
  'UPDATE pg_catalog.pg_proc SET prosecdef = true WHERE proname = \'f\';',
  '-- this migration adds no SECURITY DEFINER function (a mention in a comment still requires review)\nselect 1;',
]
for (const sql of DEFINER) {
  test(`security definer is review-required: ${JSON.stringify(sql).slice(0, 70)}`, () => {
    assert.ok(reasons(sql).includes('security_definer'), JSON.stringify(reasons(sql)))
    assert.equal(DESTRUCTIVE_PATTERN.test(sql), false, 'distinct from destructive: none of these has a destructive keyword')
  })
}

const AUTH = [
  'select count(*) from auth.sessions;',
  'SELECT 1 FROM AUTH.SESSIONS;',
  'select 1 from "auth"."sessions";',
  'select 1 from auth . "users";',
  'select 1 from "auth" . users;',
  'create table t (user_id uuid references auth.users(id) on delete cascade);',
  "select to_regclass('auth.sessions');",
  "select 'auth.users'::regclass;",
  'create trigger t after insert on auth.users for each row execute function public.f();',
  'grant select on all tables in schema auth to service_role;',
  'alter default privileges in schema auth grant select on tables to authenticated;',
  'grant usage on schema auth to anon;',
  'set search_path = public, auth;',
  'SET search_path TO auth;',
  "alter function public.f() set search_path = '$user', auth;",
  "select set_config('search_path', 'auth, public', true);",
  'CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ select count(*)::int from auth.mfa_factors $$;',
  'select auth.uidx();',
]
for (const sql of AUTH) {
  test(`protected auth access is review-required: ${JSON.stringify(sql).slice(0, 70)}`, () => {
    assert.ok(reasons(sql).includes('auth_schema'), JSON.stringify(reasons(sql)))
  })
}

const EVASION = [
  ['dynamic EXECUTE of any string', "DO $$ BEGIN EXECUTE v_sql; END $$;", 'dynamic_sql'],
  ['dynamic EXECUTE assembled from chr()', "DO $$ BEGIN EXECUTE chr(115) || 'elect 1'; END $$;", 'dynamic_sql'],
  ['unicode-escaped identifier', 'select 1 from U&"\\0061uth".sessions;', 'unicode_escape'],
  ['unicode-escaped string', "select to_regclass(U&'\\0061uth.users');", 'unicode_escape'],
  ['direct catalog update', "update pg_authid set rolbypassrls = true where rolname = 'x';", 'catalog_write'],
  ['create role', 'create role intruder login;', 'role_authority'],
  ['alter role bypassrls', 'alter role authenticated bypassrls;', 'role_authority'],
  ['membership of a platform role', 'grant service_role to authenticated;', 'role_authority'],
  ['quoted platform role membership', 'grant "service_role" to anon;', 'role_authority'],
  ['role switch', 'set local role service_role;', 'role_authority'],
  ['session authorization', 'set session authorization postgres;', 'role_authority'],
  ['ownership transfer', 'alter function public.f() owner to postgres;', 'role_authority'],
  ['rls disabled', 'alter table public.t disable row level security;', 'role_authority'],
]
for (const [name, sql, reason] of EVASION) {
  test(`cannot be statically cleared, review-required: ${name}`, () => {
    assert.ok(reasons(sql).includes(reason), `${name}: ${JSON.stringify(reasons(sql))}`)
  })
}

const ORDINARY = [
  'create table public.t (id uuid primary key, tenant_id uuid not null);',
  'alter table public.t add column note text; create index if not exists t_note on public.t (note);',
  "create policy t_select on public.t for select to authenticated using (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);",
  'create policy t_own on public.t using (user_id = auth.uid());',
  'create policy t_own2 on public.t using (user_id = auth.uid ( ));',
  "create policy t_role on public.t using (auth.role() = 'authenticated' and auth.email() is not null);",
  "CREATE FUNCTION public.f() RETURNS uuid LANGUAGE sql STABLE SET search_path = '' AS $$ select auth.uid() $$;",
  'create trigger t_touch before update on public.t for each row execute function public.touch();',
  'create trigger t_touch2 before update on public.t for each row execute procedure public.touch();',
  'grant execute on function public.f() to authenticated; revoke execute on function public.f() from anon;',
  "comment on table public.t is 'the worker may execute nothing here; security is definitely on';",
  'alter table public.t enable row level security;',
  'insert into public.settings (key, value) values (\'x\', \'y\');',
  "select 'oauth.tokens' as label from public.t;",
]
for (const sql of ORDINARY) {
  test(`ordinary application SQL is not security-sensitive: ${JSON.stringify(sql).slice(0, 70)}`, () => {
    assert.deepEqual(reasons(sql), [])
  })
}

test('only the four read-only auth helper functions are exempt, and only when called', () => {
  assert.deepEqual([...AUTH_HELPER_FUNCTIONS], ['uid', 'jwt', 'role', 'email'])
  assert.deepEqual(reasons('select auth.uid();'), [])
  assert.ok(reasons('select auth.uid;').includes('auth_schema'))
  assert.ok(reasons('select auth.users_view();').includes('auth_schema'))
  assert.ok(reasons('select auth.identities.id from auth.identities;').includes('auth_schema'))
})

test('comment stripping keeps strings and identifiers but scans dollar bodies as code', () => {
  assert.equal(stripSqlComments("select '-- not a comment', \"a--b\" -- gone\n").includes('gone'), false)
  assert.ok(stripSqlComments("select '-- not a comment'").includes("'-- not a comment'"))
  assert.ok(stripSqlComments('select "a/*b*/c"').includes('"a/*b*/c"'))
  assert.ok(stripSqlComments("select E'it\\'s -- still a string'").includes('still a string'))
  assert.ok(stripSqlComments('$f$ select 1 -- body comment\n from x $f$').includes('from x'))
  assert.equal(stripSqlComments('$f$ select 1 -- body comment\n$f$').includes('body comment'), false)
})

test('a file-level exemption marker, header or filename has no effect', () => {
  const sql = '-- migration-safety: reviewed-not-sensitive\n-- staging-security: exempt\nCREATE FUNCTION f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ select 1 $$;'
  assert.ok(isSecuritySensitive(sql))
  // Code only (JS comments removed): no environment read, no exemption / allowlist / skip logic, no filesystem access.
  const code = read('scripts/migration-security-classifier.mjs').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
  assert.doesNotMatch(code, /process\.env|exempt|allowlist|skip|readFile|import /i, 'no environment, marker, allowlist or file input')
})

// ---------------------------------------------------------------- the trusted planner
const evaluation = (missing) => ({ status: 'PENDING', missingOnRemote: missing, unknownOnRemote: [], duplicateCoverage: { incompleteGroups: [] } })
const file = (version, content) => ({ filename: `${version}_m${version}.sql`, version, content })
const HISTORY = [
  file('260', 'CREATE FUNCTION old() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ select 1 $$;'),
  file('261', 'select count(*) from auth.sessions;'),
]
const SENSITIVE_262 = file('262', [
  'CREATE FUNCTION public.agent__verified_human_claims() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER',
  "SET search_path = '' AS $function$ BEGIN",
  '  IF NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = v_sid) THEN RETURN NULL; END IF; END; $function$;',
  'GRANT EXECUTE ON FUNCTION public.agent_verified_human_probe(text) TO authenticated;',
].join('\n'))

test('ordinary non-destructive, non-sensitive pending migrations keep their current behaviour', () => {
  const plan = planStagingMigrations({ evaluation: evaluation(['262']), migrations: [...HISTORY, file('262', 'alter table public.t add column c int;')] })
  assert.deepEqual(plan, { pending: ['262_m262.sql'] })
  assert.deepEqual(planStagingMigrations({ evaluation: evaluation([]), migrations: HISTORY }), { pending: [] })
})

test('only PENDING migrations are classified; sensitive history already on staging never blocks a candidate', () => {
  assert.deepEqual(planStagingMigrations({ evaluation: evaluation(['262']), migrations: [...HISTORY, file('262', 'select 1;')] }).pending, ['262_m262.sql'])
})

test('destructive pending migrations remain refused with the unchanged message', () => {
  assert.throws(() => planStagingMigrations({ evaluation: evaluation(['262']), migrations: [...HISTORY, file('262', 'drop table public.t;')] }),
    /^Error: Refusing to auto-apply destructive pending migration\(s\) to persistent staging: 262_m262\.sql\. Apply them deliberately with the Staging Database Migrate workflow from main\.$/)
})

test('a SECURITY DEFINER / auth-reading migration with no destructive keyword is refused, as a distinct reason', () => {
  assert.equal(DESTRUCTIVE_PATTERN.test(SENSITIVE_262.content), false)
  assert.throws(() => planStagingMigrations({ evaluation: evaluation(['262']), migrations: [...HISTORY, SENSITIVE_262] }),
    (error) => /security-sensitive pending migration\(s\).*262_m262\.sql \(auth_schema, security_definer\)/.test(error.message)
      && /Staging Reviewed Migration Preview/.test(error.message) && !/destructive/.test(error.message))
})

test('a sensitive file hidden among ordinary pending files is still refused, and named', () => {
  const migrations = [...HISTORY, file('262', 'select 1;'), { ...SENSITIVE_262, filename: '263_m263.sql', version: '263' }, file('264', 'select 2;')]
  assert.throws(() => planStagingMigrations({ evaluation: evaluation(['262', '263', '264']), migrations }), /263_m263\.sql \(auth_schema, security_definer\)/)
})

test('the candidate cannot bypass the rule: no evaluation field, marker or environment variable relaxes it', () => {
  const sneaky = { ...evaluation(['262']), allowSensitive: true, reviewed: true, status: 'PENDING' }
  process.env.STAGING_ALLOW_SECURITY_SENSITIVE = '1'
  process.env.ALLOW_SENSITIVE_MIGRATIONS = 'true'
  try {
    assert.throws(() => planStagingMigrations({ evaluation: sneaky, migrations: [...HISTORY, { ...SENSITIVE_262, content: `-- migration-safety: destructive-reviewed\n-- reviewed: true\n${SENSITIVE_262.content}` }] }), /security-sensitive/)
  } finally {
    delete process.env.STAGING_ALLOW_SECURITY_SENSITIVE
    delete process.env.ALLOW_SENSITIVE_MIGRATIONS
  }
  for (const bad of [{}, { files: [] }, { id: 'x', files: new Map() }, { id: 'x', files: { '262_m262.sql': sha256(SENSITIVE_262.content) } }]) {
    assert.throws(() => planStagingMigrations({ evaluation: evaluation(['262']), migrations: [...HISTORY, SENSITIVE_262], reviewed: bad }), /malformed/)
  }
})

test('the reviewed preview still permits an exactly pinned sensitive migration', () => {
  const reviewed = { id: 'h7-p2-verified-human-identity-262', files: new Map([['262_m262.sql', sha256(SENSITIVE_262.content)]]) }
  assert.deepEqual(planStagingMigrations({ evaluation: evaluation(['262']), migrations: [...HISTORY, SENSITIVE_262], reviewed }),
    { pending: ['262_m262.sql'], reviewed: 'h7-p2-verified-human-identity-262' })
})

test('the reviewed preview refuses a mismatched digest, an extra file or a missing file', () => {
  const pinned = new Map([['262_m262.sql', sha256(SENSITIVE_262.content)]])
  const changed = { ...SENSITIVE_262, content: `${SENSITIVE_262.content}\n-- edited after review` }
  assert.throws(() => planStagingMigrations({ evaluation: evaluation(['262']), migrations: [...HISTORY, changed], reviewed: { id: 'r', files: pinned } }), /differ\(s\) from the approved digest/)
  assert.throws(() => planStagingMigrations({ evaluation: evaluation(['262']), migrations: [...HISTORY, SENSITIVE_262], reviewed: { id: 'r', files: new Map([['262_m262.sql', '0'.repeat(64)]]) } }), /approved digest/)
  assert.throws(() => planStagingMigrations({ evaluation: evaluation(['262', '263']), migrations: [...HISTORY, SENSITIVE_262, file('263', 'select 1;')], reviewed: { id: 'r', files: pinned } }), /not exactly the approved set/)
  assert.throws(() => planStagingMigrations({ evaluation: evaluation(['262']), migrations: [...HISTORY, SENSITIVE_262], reviewed: { id: 'r', files: new Map([...pinned, ['263_m263.sql', '1'.repeat(64)]]) } }), /not exactly the approved set/)
})

test('assertPendingPolicy is the one shared policy (planner and the pre-push check use the same function)', () => {
  assert.throws(() => assertPendingPolicy([SENSITIVE_262]), /security-sensitive/)
  assert.doesNotThrow(() => assertPendingPolicy([file('262', 'select 1;')]))
  const apply = read('scripts/staging-migration-apply-workspace.mjs')
  assert.match(apply, /import \{ assertPendingPolicy, planStagingMigrations \} from '\.\/staging-migration-plan\.mjs';/)
  const pushAt = apply.indexOf("'db push',")
  const checkAt = apply.lastIndexOf('assertPendingPolicy(', pushAt)
  assert.ok(checkAt > 0 && pushAt - checkAt < 900, 'the policy is re-asserted on the workspace bytes immediately before the mutating push')
})

// ---------------------------------------------------------------- trust boundaries
test('the classifier is a pinned privileged control-plane file and is imported only by the trusted planner', () => {
  assert.ok(PRIVILEGED_STAGING_FILES.includes('scripts/migration-security-classifier.mjs'))
  const importers = readdirSync('scripts').filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
    .filter((name) => read(`scripts/${name}`).includes("from './migration-security-classifier.mjs'"))
  assert.deepEqual(importers, ['staging-migration-plan.mjs'])
})

test('only the reviewed-preview driver can pass a reviewed allowance; no workflow or environment can', () => {
  const setters = readdirSync('scripts').filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
    .filter((name) => /reviewedMigrations\s*:/.test(read(`scripts/${name}`)))
  assert.deepEqual(setters, ['staging-reviewed-migration-preview.mjs'])
  for (const workflow of readdirSync('.github/workflows')) {
    assert.doesNotMatch(read(`.github/workflows/${workflow}`), /SECURITY_SENSITIVE|ALLOW_SENSITIVE|reviewedMigrations/i, workflow)
  }
  assert.doesNotMatch(read('scripts/staging-migration-plan.mjs'), /process\.env\.(?!STAGING_SUPABASE_DB_URL|GITHUB_OUTPUT)/)
})

test('the destructive-SQL rule itself is unchanged', () => {
  assert.equal(DESTRUCTIVE_PATTERN.source,
    String.raw`\b(?:DROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA|FUNCTION|POLICY|INDEX)|TRUNCATE\b|DELETE\s+FROM\b|ALTER\s+(?:TABLE|TYPE)\b[^;]*\b(?:DROP|RENAME|TYPE)\b)`)
  assert.equal(DESTRUCTIVE_PATTERN.flags, 'i')
})
