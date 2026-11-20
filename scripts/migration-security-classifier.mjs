/**
 * Security-sensitive migration classifier (trusted staging control plane).
 *
 * A pending migration that introduces or changes DATABASE AUTHORITY must not reach the persistent shared staging
 * database merely because its PR's CI succeeded. It needs the single-use, human-approved Staging Reviewed Migration
 * Preview (exact PR, head SHA and file digest pinned on main; see staging-reviewed-migrations.mjs) -- the same path
 * destructive SQL already needs. "Security-sensitive" and "destructive" are DISTINCT reasons; DESTRUCTIVE_PATTERN in
 * check-migrations.mjs is unchanged.
 *
 * Classification is by CONTENT only. There is no marker, header, filename, PR text, environment variable or
 * candidate-controlled configuration that exempts a file: the only exception is the reviewed preview's exact digest pin.
 *
 * Deliberately conservative (a false positive costs a review; a false negative ships authority unreviewed):
 *   * rules are matched against several views of the file: the raw text (a mention even inside a comment counts for the
 *     definer and auth rules), the text with SQL comments removed and dollar-quoted bodies scanned AS CODE (so function
 *     bodies are inspected and comment-split tokens rejoin), that text with quote characters and `||` removed (so
 *     'SECURITY ' || 'DEFINER', "auth"."users" and 'auth.sessions'::regclass are seen), and a statements view with
 *     single-quoted string contents blanked (used only for EXECUTE, so COMMENT ... IS '... execute ...' is not dynamic
 *     SQL);
 *   * dynamic SQL (plpgsql EXECUTE of a string), unicode-escaped identifiers / strings and direct catalog writes cannot be
 *     statically cleared, so each is sensitive by itself;
 *   * every GRANT and every ALTER DEFAULT PRIVILEGES is a privilege change and sensitive (a standalone grant can activate
 *     a protected function that was deliberately created with no grant). The ONE exemption is the established product
 *     pattern, proven per statement on a top-level parse with strings and dollar bodies opaque: a GRANT to exactly
 *     service_role, without grant option, of table privileges on a table this same file creates, or of EXECUTE / ALL on
 *     a function this same file creates with a matching argument-type signature -- never on a protected name (agent_*,
 *     the JWT hook, auth.*). Any other GRANT keyword anywhere (function bodies included) keeps the file sensitive;
 *   * the four auth helpers are exempt only when CALLED; naming one after FUNCTION / PROCEDURE / ROUTINE (create,
 *     replace, alter, comment, grant, revoke) or in a GRANT / REVOKE target list is an auth-schema change;
 *   * policy / RLS widening: ALTER POLICY, an always-true USING / WITH CHECK, any policy on a protected agent_* table,
 *     NO FORCE ROW LEVEL SECURITY, views that run as their owner (no security_invoker), materialized views, LEAKPROOF.
 */

/** Read-only Supabase auth helper FUNCTIONS used by ordinary RLS policies. Any other auth.<name> is sensitive. */
export const AUTH_HELPER_FUNCTIONS = Object.freeze(['uid', 'jwt', 'role', 'email']);

const HELPERS = AUTH_HELPER_FUNCTIONS.join('|');
const PATH_ITEM = String.raw`["']?[a-z_0-9$]*["']?`;
const PLATFORM_ROLES = String.raw`anon|authenticated|service_role|authenticator|agent_worker|postgres|supabase_[a-z_]+|pg_[a-z_]+`;
/** Protected public objects: the agent harness authority surface and the JWT custom-claims hook. */
const PROTECTED_NAME = String.raw`(?:public ?\. ?)?(?:agent_[a-z_0-9$]*|custom_access_token_hook\b)`;
const ROUTINE = String.raw`(?:function|procedure|routine|aggregate)s?`;
const ALWAYS_TRUE = String.raw`\( ?(?:true|not false|1 ?= ?1|'t'|'true'|'on') ?\)`;

/**
 * [reason code, regex, scope]. Scopes: 'all' = raw + code + unquoted; 'code' = code + unquoted (comments ignored);
 * 'statements' = code with single-quoted string contents blanked. Views are lower-cased, whitespace collapsed to ' '.
 */
export const SECURITY_SENSITIVE_RULES = Object.freeze([
  // A definer function (created, altered or replaced) or a direct flip of the catalog flag.
  ['security_definer', /\bsecurity ?definer\b/, 'all'],
  ['security_definer', /\bprosecdef\b/, 'all'],
  // Any auth-schema relation (auth.sessions, auth.users, "auth"."x", auth . x, ...), except the four helper calls.
  ['auth_schema', new RegExp(String.raw`\bauth ?\. ?(?!(?:${HELPERS}) ?\()[a-z_0-9"$]`), 'all'],
  // An auth-schema routine named as an object (create / replace / alter / comment / grant / revoke), helpers included.
  ['auth_schema', new RegExp(String.raw`\b${ROUTINE} auth ?\.`), 'all'],
  ['auth_schema', /\b(?:grant|revoke)\b[^;]*\bon\b[^;]*\bauth ?\./, 'code'],
  // The auth schema itself: grants / default privileges / ownership "on schema auth", "in schema auth", schema DDL.
  ['auth_schema', /\b(?:on|in) schema (?:[a-z_0-9"]+ ?, ?)*"?auth\b/, 'all'],
  ['auth_schema', /\b(?:create|alter|drop) schema (?:if (?:not )?exists )?auth\b/, 'code'],
  ['auth_schema', /\bset schema auth\b/, 'code'],
  // A search_path list containing auth (unqualified auth relations): SET / ALTER ... SET / function SET, or set_config.
  ['auth_schema', new RegExp(String.raw`\bsearch_path ?(?:=|to) ?(?:${PATH_ITEM} ?, ?)*["']?auth\b`), 'code'],
  ['auth_schema', new RegExp(String.raw`\bset_config ?\( ?["']?search_path["']? ?, ?["']?(?:[a-z_0-9$"]* ?, ?)*"?auth\b`), 'code'],
  // Dynamic SQL: plpgsql EXECUTE of a string / expression (not EXECUTE FUNCTION|PROCEDURE, not GRANT/REVOKE EXECUTE ON).
  ['dynamic_sql', /\bexecute (?!(?:function|procedure|on)\b)/, 'statements'],
  // Unicode-escaped identifiers or strings can spell any name.
  ['unicode_escape', /\bu&["']/, 'code'],
  // Direct catalog DML.
  ['catalog_write', /\b(?:update|insert into|delete from) (?:pg_catalog ?\. ?)?pg_[a-z_]+\b/, 'code'],
  // Role authority: role DDL, membership of a platform role, role switching, ownership transfer, RLS bypass / disable.
  ['role_authority', /\b(?:create|alter|drop) (?:role|user|group)\b/, 'code'],
  ['role_authority', new RegExp(String.raw`\bgrant (?:[a-z_0-9"]+ ?, ?)*"?(?:${PLATFORM_ROLES})"? to\b`), 'code'],
  ['role_authority', /\bset (?:local |session )?role\b/, 'code'],
  ['role_authority', /\bset (?:local |session )?session authorization\b/, 'code'],
  ['role_authority', /\bowner to\b/, 'code'],
  ['role_authority', /\bbypassrls\b/, 'code'],
  ['role_authority', /\bdisable row level security\b/, 'code'],
  ['role_authority', /\bcreate event trigger\b/, 'code'],
  // Privilege changes that are never exempt (every GRANT is checked separately: see grantIsOrdinary).
  ['privilege_grant', /\balter default privileges\b/, 'code'],
  // Redefining or altering a protected function in place (CREATE OR REPLACE keeps its existing grants).
  ['protected_object', new RegExp(String.raw`\b(?:create or replace|alter) (?:function|procedure|routine) ${PROTECTED_NAME}`), 'code'],
  // Policy / RLS widening.
  ['policy_authority', /\balter policy\b/, 'code'],
  ['policy_authority', new RegExp(String.raw`\bpolicy\b[^;]*\b(?:using|check) ?${ALWAYS_TRUE}`), 'code'],
  ['policy_authority', new RegExp(String.raw`\bpolicy [a-z_0-9$]+ on (?:only )?${PROTECTED_NAME}`), 'code'],
  ['policy_authority', /\bno force row level security\b/, 'code'],
  ['policy_authority', /\bcreate (?:or replace )?(?:(?:temp|temporary|recursive) )*view\b(?![^;]*\bsecurity_invoker(?: ?= ?(?:true|on|1|yes))? ?[,)])/, 'code'],
  ['policy_authority', /\bmaterialized view\b/, 'code'],
  ['policy_authority', /\bsecurity_invoker ?= ?(?:false|off|0|no)\b/, 'code'],
  ['policy_authority', /\breset ?\([^)]*\bsecurity_invoker\b/, 'code'],
  ['policy_authority', /\bleakproof\b/, 'code'],
]);

/**
 * Remove SQL comments (`--` to end of line, nested block comments) outside single-quoted strings and quoted
 * identifiers. Dollar-quote delimiters are dropped and their bodies are scanned AS CODE (comments inside bodies are
 * removed too), so a function body is classified like top-level SQL. Single-quoted strings (incl. E'' with backslash
 * escapes) and double-quoted identifiers are kept verbatim. Unterminated constructs keep the rest of the text.
 * With `opaque`, single-quoted strings become '' and each dollar-quoted body becomes one ` $$ ` token instead: the view
 * used to find TOP-LEVEL statements, so text inside a literal or a body can never pose as a statement.
 */
export function stripSqlComments(sql, { opaque = false } = {}) {
  const text = String(sql ?? '');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '-' && next === '-') {
      const end = text.indexOf('\n', i);
      out += ' ';
      i = end === -1 ? text.length : end;
      continue;
    }
    if (c === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') { depth += 1; j += 2; continue; }
        if (text[j] === '*' && text[j + 1] === '/') { depth -= 1; j += 2; continue; }
        j += 1;
      }
      out += ' ';
      i = j;
      continue;
    }
    if (c === "'") {
      const escapeBackslash = /[eE]/.test(text[i - 1] ?? '') && !/[A-Za-z0-9_]/.test(text[i - 2] ?? '');
      let j = i + 1;
      while (j < text.length) {
        if (escapeBackslash && text[j] === '\\') { j += 2; continue; }
        if (text[j] === "'" && text[j + 1] === "'") { j += 2; continue; }
        if (text[j] === "'") { j += 1; break; }
        j += 1;
      }
      out += opaque ? "''" : text.slice(i, j);
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '"' && text[j + 1] === '"') { j += 2; continue; }
        if (text[j] === '"') { j += 1; break; }
        j += 1;
      }
      out += text.slice(i, j);
      i = j;
      continue;
    }
    if (c === '$') {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i));
      if (tag && !/[A-Za-z0-9_]/.test(text[i - 1] ?? '')) {
        if (opaque) {  // the whole body is one opaque token (an unterminated body swallows the rest)
          const close = text.indexOf(tag[0], i + tag[0].length);
          out += ' $$ ';
          i = close === -1 ? text.length : close + tag[0].length;
          continue;
        }
        out += ' ';  // the delimiter goes; the body that follows is scanned as code
        i += tag[0].length;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

function collapse(text) {
  return text.toLowerCase().replace(/\s+/g, ' ');
}

function blankStrings(code) {
  return code.replace(/'(?:[^']|'')*'/g, "''");
}

/** The views rules are matched against (lower-cased, whitespace collapsed). */
export function classifierViews(sql) {
  const code = stripSqlComments(sql);
  return {
    raw: collapse(String(sql ?? '')),
    code: collapse(code),
    unquoted: collapse(code.replace(/\|\|/g, ' ').replace(/["']/g, '')),
    statements: collapse(blankStrings(code)),
  };
}

// ---------------------------------------------------------------- the single GRANT exemption
const IDENT = String.raw`[a-z_][a-z_0-9$]*`;
const QUALIFIED = String.raw`(?:public ?\. ?)?${IDENT}`;
const NAME = new RegExp(String.raw`^${QUALIFIED}$`);
const PROTECTED = new RegExp(String.raw`^${PROTECTED_NAME}`);
const TABLE_PRIV = 'select|insert|update|delete|truncate|references|trigger';
const TABLE_PRIVILEGES = new RegExp(String.raw`^(?:all(?: privileges)?|(?:${TABLE_PRIV})(?: ?, ?(?:${TABLE_PRIV}))*)$`);
const GRANT_WORD = /(?<!\brevoke )\bgrant (?!option\b)/g;

/** Top-level statements: comments removed, strings and dollar bodies opaque, lower-cased, whitespace collapsed. */
export function topLevelStatements(sql) {
  return stripSqlComments(sql, { opaque: true }).split(';').map((statement) => collapse(statement).trim()).filter(Boolean);
}

const normalizeName = (name) => name.replace(/ /g, '').replace(/^public\./, '');

/** Split on depth-0 commas; null when parentheses are unbalanced. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    else if (text[i] === ',' && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
    if (depth < 0) return null;
  }
  if (depth !== 0) return null;
  const last = text.slice(start).trim();
  if (last || parts.length) parts.push(last);
  return parts;
}

/** The balanced `( ... )` opening at `from`: [inner text, index after the `)`], or null. */
function parenthesized(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')' && (depth -= 1) === 0) return [text.slice(from + 1, i), i + 1];
  }
  return null;
}

/**
 * Candidate type spellings of one argument: [whole, without a leading parameter name]. Fail closed (null): OUT
 * arguments, empty arguments, and a default where none is allowed (GRANT signatures carry none).
 */
function argumentTypes(argument, { allowDefault }) {
  let arg = argument.replace(/ ?([()[\],]) ?/g, '$1').trim();
  const defaultAt = arg.search(/ default\b|=/);
  if (defaultAt !== -1) {
    if (!allowDefault) return null;
    arg = arg.slice(0, defaultAt).trim();
  }
  const mode = /^(in|out|inout|variadic) /.exec(arg);
  if (mode?.[1] === 'out') return null;
  if (mode) arg = arg.slice(mode[0].length);
  if (!arg) return null;
  const words = arg.split(' ');
  return words.length > 1 ? [arg, words.slice(1).join(' ')] : [arg];
}

function signature(argsText, options) {
  if (argsText.trim() === '') return [];
  const args = splitTopLevel(argsText);
  if (args === null) return null;
  const types = args.map((arg) => argumentTypes(arg, options));
  return types.some((t) => t === null) ? null : types;
}

const sameSignature = (a, b) => a.length === b.length && a.every((types, i) => types.some((t) => b[i].includes(t)));

/** Objects this file creates in TOP-LEVEL statements: { tables: Set<name>, routines: [{ kind, name, types }] }. */
function createdObjects(statements) {
  const tables = new Set();
  const routines = [];
  const tablePattern = new RegExp(String.raw`^create (?:(?:global |local )?(?:temporary|temp) |unlogged )?table (?:if not exists )?(${QUALIFIED}) ?\(`);
  const routinePattern = new RegExp(String.raw`^create (?:or replace )?(function|procedure) (${QUALIFIED}) ?\(`);
  for (const statement of statements) {
    const table = tablePattern.exec(statement);
    if (table) tables.add(normalizeName(table[1]));
    const routine = routinePattern.exec(statement);
    const args = routine && parenthesized(statement, routine[0].length - 1);
    const types = args && signature(args[0], { allowDefault: true });
    if (types) routines.push({ kind: routine[1], name: normalizeName(routine[2]), types });
  }
  return { tables, routines };
}

/** True only for the one exempt GRANT shape (see the header); any other GRANT is a sensitive privilege change. */
export function grantIsOrdinary(statement, created) {
  if (/["$]| with grant option\b| granted by\b/.test(statement)) return false;
  const match = /^grant (.+?) on (?:(function|procedure|routine|table) )?(.+) to (.+)$/.exec(statement);
  if (!match || match[4] !== 'service_role') return false;
  const [, privileges, kind = 'table', targetsText] = match;
  const targets = splitTopLevel(targetsText);
  if (!targets?.length) return false;
  if (kind === 'table') {
    return TABLE_PRIVILEGES.test(privileges) && targets.every((target) => NAME.test(target) && !PROTECTED.test(target)
      && created.tables.has(normalizeName(target)));
  }
  if (!/^(?:execute|all(?: privileges)?)$/.test(privileges)) return false;
  const head = new RegExp(String.raw`^(${QUALIFIED}) ?\(`);
  return targets.every((target) => {
    const name = head.exec(target);
    if (!name || PROTECTED.test(name[1])) return false;
    const args = parenthesized(target, name[0].length - 1);
    if (!args || args[1] !== target.length) return false;
    const types = signature(args[0], { allowDefault: false });
    return types !== null && created.routines.some((routine) => routine.name === normalizeName(name[1])
      && (kind === 'routine' || routine.kind === kind) && sameSignature(types, routine.types));
  });
}

/** Every GRANT keyword in the code (function bodies included) must be accounted for by an ordinary top-level GRANT. */
function hasSensitiveGrant(sql, views) {
  const occurrences = (views.statements.match(GRANT_WORD) ?? []).length;
  if (occurrences === 0) return false;
  const statements = topLevelStatements(sql);
  const created = createdObjects(statements);
  const ordinary = statements.filter((statement) => statement.startsWith('grant ') && grantIsOrdinary(statement, created)).length;
  return occurrences > ordinary;
}

const VIEW_SETS = Object.freeze({ all: ['raw', 'code', 'unquoted'], code: ['code', 'unquoted'], statements: ['statements'] });

/** Sorted, de-duplicated reason codes; [] = not security-sensitive. */
export function securitySensitiveReasons(sql) {
  const views = classifierViews(sql);
  const reasons = new Set();
  for (const [reason, pattern, scope] of SECURITY_SENSITIVE_RULES) {
    if (VIEW_SETS[scope].some((name) => pattern.test(views[name]))) reasons.add(reason);
  }
  if (hasSensitiveGrant(sql, views)) reasons.add('privilege_grant');
  return [...reasons].sort();
}

export function isSecuritySensitive(sql) {
  return securitySensitiveReasons(sql).length > 0;
}
