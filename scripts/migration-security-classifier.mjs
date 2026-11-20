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
 *     statically cleared, so each is sensitive by itself.
 */

/** Read-only Supabase auth helper FUNCTIONS used by ordinary RLS policies. Any other auth.<name> is sensitive. */
export const AUTH_HELPER_FUNCTIONS = Object.freeze(['uid', 'jwt', 'role', 'email']);

const HELPERS = AUTH_HELPER_FUNCTIONS.join('|');
const PATH_ITEM = String.raw`["']?[a-z_0-9$]*["']?`;
const PLATFORM_ROLES = String.raw`anon|authenticated|service_role|authenticator|agent_worker|postgres|supabase_[a-z_]+|pg_[a-z_]+`;

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
  // The auth schema itself: grants / default privileges / ownership "on schema auth", "in schema auth".
  ['auth_schema', /\b(?:on|in) schema (?:[a-z_0-9"]+ ?, ?)*"?auth\b/, 'all'],
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
]);

/**
 * Remove SQL comments (`--` to end of line, nested block comments) outside single-quoted strings and quoted
 * identifiers. Dollar-quote delimiters are dropped and their bodies are scanned AS CODE (comments inside bodies are
 * removed too), so a function body is classified like top-level SQL. Single-quoted strings (incl. E'' with backslash
 * escapes) and double-quoted identifiers are kept verbatim. Unterminated constructs keep the rest of the text.
 */
export function stripSqlComments(sql) {
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
      out += text.slice(i, j);
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

const VIEW_SETS = Object.freeze({ all: ['raw', 'code', 'unquoted'], code: ['code', 'unquoted'], statements: ['statements'] });

/** Sorted, de-duplicated reason codes; [] = not security-sensitive. */
export function securitySensitiveReasons(sql) {
  const views = classifierViews(sql);
  const reasons = new Set();
  for (const [reason, pattern, scope] of SECURITY_SENSITIVE_RULES) {
    if (VIEW_SETS[scope].some((name) => pattern.test(views[name]))) reasons.add(reason);
  }
  return [...reasons].sort();
}

export function isSecuritySensitive(sql) {
  return securitySensitiveReasons(sql).length > 0;
}
