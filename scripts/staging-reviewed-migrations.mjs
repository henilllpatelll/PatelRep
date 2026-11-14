/**
 * Reviewed staging migration previews: the ONLY way a pending migration that matches DESTRUCTIVE_PATTERN can reach the
 * persistent shared staging database before its PR merges.
 *
 * Normal Staging Candidate behaviour is unchanged: staging-migration-plan.mjs still refuses every destructive pending
 * migration. A preview is a narrow, single-use exception that needs ALL of the following, each checked independently:
 *   1. an entry in supabase/staging-reviewed-migrations.json ON MAIN (reached main through a reviewed, human-merged PR)
 *      that pins the repository, PR number, head branch, exact 40-hex head SHA, the staging history head it expects, a
 *      short approval window, and a SHA-256 digest for EVERY file it authorizes,
 *   2. the operator restating every filename=digest pair at dispatch (must equal the entry exactly),
 *   3. the candidate files at the pinned SHA hashing to those digests, with the pending set equal to the approved set,
 *   4. read-only precondition probes against staging, and a GitHub Environment approval before anything is applied.
 * There is no flag, input or environment variable that relaxes the destructive-SQL rule for any other file.
 *
 * After a preview is applied, verifyReviewedBindings keeps the approval honest for every later candidate: a candidate
 * whose copy of an applied, reviewed file differs from the approved digest is refused (the applied SQL can never be
 * re-run, so a changed file would silently diverge from staging; fixes go in a NEW forward migration).
 */
import { readFileSync } from 'node:fs';

import { normalizeVersion } from './check-db-drift.mjs';
import { parseMigrationFilename, sha256 } from './check-migrations.mjs';

export const REVIEWED_REGISTRY_PATH = 'supabase/staging-reviewed-migrations.json';
export const PREVIEW_WORKFLOW_NAME = 'Staging Reviewed Migration Preview';
export const APPROVAL_ENVIRONMENT = 'staging-migration-approval';
export const MAX_APPROVAL_WINDOW_DAYS = 14;

const ENTRY_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^(?!main$)[A-Za-z0-9._/-]{1,200}$/;
const PROBE_NAME = /^[a-z][a-z0-9_]{2,63}$/;
const ENTRY_KEYS = ['id', 'repository', 'pr_number', 'head_ref', 'head_sha', 'base_staging_version', 'approved_at', 'expires_at', 'review_document', 'files', 'preconditions', 'postconditions'];

function fail(message) {
  throw new Error(`Reviewed staging migration preview: ${message}`);
}

function timestamp(value, label) {
  const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) ? Date.parse(value) : NaN;
  if (Number.isNaN(parsed)) fail(`${label} must be an ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ).`);
  return parsed;
}

/** A probe is ONE read-only SELECT returning a single boolean; it runs with default_transaction_read_only = on. */
export function assertReadOnlyProbe(probe, label) {
  if (!PROBE_NAME.test(probe?.name ?? '')) fail(`${label} needs a snake_case name.`);
  if (typeof probe.probe !== 'string' || !/^\s*select\b/i.test(probe.probe) || probe.probe.includes(';')) {
    fail(`${label} ${probe.name} must be a single read-only SELECT without ';'.`);
  }
  if (/\b(?:insert|update|delete|truncate|alter|drop|create|grant|revoke|copy|call|do|set|reset|lock|vacuum|refresh|pg_sleep|dblink|lo_import|lo_export|set_config|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_advisory_lock|pg_advisory_xact_lock|pg_notify)\b/i.test(probe.probe.replace(/'[^']*'/g, "''"))) {
    fail(`${label} ${probe.name} contains a statement or function a read-only probe never needs.`);
  }
}

/** Structural validation of the whole registry. Expired entries stay valid as the historical record. */
export function validateReviewedRegistry(registry) {
  if (!registry || registry.schema_version !== 1 || registry.environment !== 'staging' || !Array.isArray(registry.entries)) {
    fail('the registry is malformed (schema_version 1, environment staging, entries[]).');
  }
  const ids = new Set();
  const approvedFiles = new Set();
  const approvedVersions = new Set();
  for (const entry of registry.entries) {
    const keys = Object.keys(entry ?? {}).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...ENTRY_KEYS].sort())) fail(`entry ${entry?.id ?? '?'} must have exactly the keys ${ENTRY_KEYS.join(', ')}.`);
    if (!ENTRY_ID.test(entry.id) || ids.has(entry.id)) fail(`entry id ${JSON.stringify(entry.id)} is invalid or duplicated.`);
    ids.add(entry.id);
    if (!REPOSITORY.test(entry.repository)) fail(`entry ${entry.id} repository is invalid.`);
    if (!Number.isInteger(entry.pr_number) || entry.pr_number < 1) fail(`entry ${entry.id} pr_number must be a positive integer.`);
    if (!BRANCH.test(entry.head_ref)) fail(`entry ${entry.id} head_ref is invalid (and can never be main).`);
    if (!COMMIT_SHA.test(entry.head_sha)) fail(`entry ${entry.id} head_sha must be a full 40-hex commit SHA.`);
    if (!/^\d{3,}$/.test(entry.base_staging_version)) fail(`entry ${entry.id} base_staging_version must be a migration version.`);
    const approvedAt = timestamp(entry.approved_at, `entry ${entry.id} approved_at`);
    const expiresAt = timestamp(entry.expires_at, `entry ${entry.id} expires_at`);
    if (expiresAt <= approvedAt || expiresAt - approvedAt > MAX_APPROVAL_WINDOW_DAYS * 86_400_000) {
      fail(`entry ${entry.id} approval window must be positive and at most ${MAX_APPROVAL_WINDOW_DAYS} days.`);
    }
    if (typeof entry.review_document !== 'string' || !/^docs\/[A-Za-z0-9._/-]+\.md$/.test(entry.review_document)) fail(`entry ${entry.id} review_document must be a docs/*.md path.`);
    if (!Array.isArray(entry.files) || entry.files.length === 0) fail(`entry ${entry.id} must approve at least one file.`);
    let previous = Number(entry.base_staging_version);
    for (const file of entry.files) {
      const parsed = parseMigrationFilename(file?.filename ?? '');
      if (!parsed || Object.keys(file).sort().join() !== 'filename,sha256') fail(`entry ${entry.id} has a malformed file record.`);
      if (!SHA256.test(file.sha256)) fail(`entry ${entry.id} ${file.filename} needs a lowercase SHA-256 digest.`);
      if (Number(parsed.version) <= previous) fail(`entry ${entry.id} files must be strictly ascending and newer than base_staging_version.`);
      previous = Number(parsed.version);
      const version = normalizeVersion(parsed.version);
      if (approvedFiles.has(file.filename) || approvedVersions.has(version)) fail(`${file.filename} is approved by more than one entry; a file is previewed once.`);
      approvedFiles.add(file.filename);
      approvedVersions.add(version);
    }
    for (const [label, list] of [['precondition', entry.preconditions], ['postcondition', entry.postconditions]]) {
      if (!Array.isArray(list) || list.length === 0) fail(`entry ${entry.id} needs at least one ${label} probe.`);
      const names = new Set();
      for (const probe of list) {
        assertReadOnlyProbe(probe, `entry ${entry.id} ${label}`);
        if (Object.keys(probe).sort().join() !== 'name,probe' || names.has(probe.name)) fail(`entry ${entry.id} ${label} ${probe.name} is malformed or duplicated.`);
        names.add(probe.name);
      }
    }
  }
  return registry;
}

export function loadReviewedRegistry(path = REVIEWED_REGISTRY_PATH) {
  let registry;
  try {
    registry = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail('unable to read the reviewed staging migration registry.');
  }
  return validateReviewedRegistry(registry);
}

/** "241_a.sql=<sha>,242_b.sql=<sha>" (commas or newlines) -> Map; malformed or duplicated pairs fail. */
export function parseFileDigests(text) {
  const pairs = String(text ?? '').split(/[\s,]+/).filter(Boolean);
  if (pairs.length === 0) fail('file_digests is empty; restate every approved filename=sha256 pair.');
  const digests = new Map();
  for (const pair of pairs) {
    const match = pair.match(/^([0-9]{3,}_[a-z0-9][a-z0-9_-]*\.sql)=([0-9a-f]{64})$/);
    if (!match || digests.has(match[1])) fail(`file_digests entry ${JSON.stringify(pair.slice(0, 80))} is malformed or duplicated.`);
    digests.set(match[1], match[2]);
  }
  return digests;
}

/**
 * Pick the entry for a dispatch and prove every restated identifier equals it. A matching SHA alone is NOT approval:
 * the environment approval is still required by the workflow before apply.
 */
export function selectPreviewEntry(registry, request, now = Date.now()) {
  const entry = registry.entries.find((item) => item.id === request.id);
  if (!entry) fail(`no reviewed registry entry ${JSON.stringify(request.id)} on main.`);
  if (request.repository !== entry.repository) fail('the repository differs from the reviewed entry.');
  if (String(request.prNumber) !== String(entry.pr_number)) fail(`PR #${request.prNumber} is not the reviewed PR #${entry.pr_number}.`);
  if (request.headSha !== entry.head_sha) fail('the requested head SHA is not the reviewed head SHA.');
  if (now < Date.parse(entry.approved_at) || now >= Date.parse(entry.expires_at)) fail(`entry ${entry.id} is outside its approval window; a new review is required.`);
  const requested = parseFileDigests(request.fileDigests);
  const approved = new Map(entry.files.map((file) => [file.filename, file.sha256]));
  if (requested.size !== approved.size || [...approved].some(([file, digest]) => requested.get(file) !== digest)) {
    fail('the restated file digests do not equal the reviewed entry exactly.');
  }
  return entry;
}

/** Live PR identity (from the GitHub API, fetched by the workflow) must still be the reviewed open PR at the pinned SHA. */
export function assertLivePullRequest(entry, pr) {
  if (!pr || pr.number !== entry.pr_number) fail('the live pull request is not the reviewed PR.');
  if (pr.state !== 'open') fail(`PR #${pr.number} is ${pr.state}, not open.`);
  if (pr.base_ref !== 'main') fail('the reviewed PR must target main.');
  if (pr.head_repo !== entry.repository) fail('the PR head must live in the same repository (no fork substitution).');
  if (pr.head_ref !== entry.head_ref) fail(`the PR head branch ${JSON.stringify(pr.head_ref)} is not the reviewed branch.`);
  if (pr.head_sha !== entry.head_sha) fail('the PR head moved since review; a new review of the exact head is required.');
}

/** The candidate checkout must hold every approved file with exactly the approved digest, and nothing else at those versions. */
export function verifyCandidateFiles(entry, migrations) {
  for (const file of entry.files) {
    const version = normalizeVersion(parseMigrationFilename(file.filename).version);
    const atVersion = migrations.filter((migration) => migration.version && normalizeVersion(migration.version) === version);
    if (atVersion.length !== 1 || atVersion[0].filename !== file.filename) fail(`the candidate must contain exactly ${file.filename} at version ${version}.`);
    if (sha256(atVersion[0].content) !== file.sha256) fail(`${file.filename} differs from its reviewed digest; a new review is required.`);
  }
}

/** The allowance handed to the planner: exactly these filenames with exactly these digests. */
export function reviewedAllowance(entry) {
  return { id: entry.id, files: new Map(entry.files.map((file) => [file.filename, file.sha256])) };
}

/** Staging history must sit exactly at the reviewed base: nothing newer applied, none of the approved versions present. */
export function assertStagingBase(entry, remoteRows) {
  const versions = remoteRows.map((row) => Number(normalizeVersion(row.version))).filter(Number.isFinite);
  const head = Math.max(0, ...versions);
  if (head !== Number(entry.base_staging_version)) {
    fail(`staging history head is ${head}, not the reviewed base ${Number(entry.base_staging_version)}; staging drifted since review.`);
  }
}

/** Every precondition/postcondition probe must return exactly `t` (read-only runner). */
export function runProbes(databaseUrl, probes, run, log = () => {}) {
  const failed = [];
  for (const probe of probes) {
    let output;
    try {
      output = String(run(databaseUrl, probe.probe)).trim();
    } catch {
      fail(`unable to run read-only probe ${probe.name}.`);
    }
    log(`  ${output === 't' ? 'PASS' : 'FAIL'} ${probe.name}`);
    if (output !== 't') failed.push(probe.name);
  }
  if (failed.length) fail(`probe(s) not satisfied on staging: ${failed.join(', ')}.`);
}

/** After apply: every approved version is recorded on staging under its approved name. */
export function assertAppliedEntry(entry, remoteRows) {
  for (const file of entry.files) {
    const parsed = parseMigrationFilename(file.filename);
    const row = remoteRows.find((item) => normalizeVersion(item.version) === normalizeVersion(parsed.version));
    if (!row) fail(`${file.filename} is not recorded in staging migration history.`);
    if (row.name && row.name !== parsed.name) fail(`staging records version ${parsed.version} as ${row.name}, not ${parsed.name}.`);
  }
}

/**
 * For EVERY candidate (Staging Candidate, Staging Database Migrate, previews): an applied, reviewed version must be the
 * exact approved file. Unapplied entries are ignored; a candidate lacking the version is BLOCKED elsewhere (unknown).
 */
export function verifyReviewedBindings(registry, { remoteRows, migrations }) {
  const applied = new Set(remoteRows.map((row) => normalizeVersion(row.version)));
  for (const entry of registry.entries) {
    for (const file of entry.files) {
      const version = normalizeVersion(parseMigrationFilename(file.filename).version);
      if (!applied.has(version)) continue;
      const atVersion = migrations.filter((migration) => migration.version && normalizeVersion(migration.version) === version);
      if (atVersion.length === 0) continue;
      if (atVersion.length !== 1 || atVersion[0].filename !== file.filename || sha256(atVersion[0].content) !== file.sha256) {
        throw new Error(`Refusing staging candidate: ${file.filename} was applied to staging by reviewed preview ${entry.id}, and this candidate's copy differs from the approved digest. Applied SQL is never re-run; ship changes as a NEW forward migration.`);
      }
    }
  }
}

/** The approval environment must really gate: required reviewers, no admin bypass, protected branches only. */
export function assertApprovalEnvironmentProtection(environment) {
  if (!environment || environment.name !== APPROVAL_ENVIRONMENT) fail(`GitHub Environment ${APPROVAL_ENVIRONMENT} does not exist.`);
  const reviewers = (environment.protection_rules ?? []).find((rule) => rule.type === 'required_reviewers');
  if (!reviewers || !Array.isArray(reviewers.reviewers) || reviewers.reviewers.length === 0) fail(`${APPROVAL_ENVIRONMENT} must require at least one reviewer.`);
  if (environment.can_admins_bypass !== false) fail(`${APPROVAL_ENVIRONMENT} must not allow administrators to bypass its protection rules.`);
  if (environment.deployment_branch_policy?.protected_branches !== true) fail(`${APPROVAL_ENVIRONMENT} must be restricted to protected branches.`);
}

/**
 * Proof from the run's own approval record that one of the environment's configured required reviewers approved THIS
 * run for the approval environment. GitHub already blocks the job without it; this is defense in depth and evidence.
 * Reviewers must be configured as individual users (a team reviewer's members cannot be matched and fail closed).
 */
export function assertRunApproved(approvals, environment) {
  const reviewers = new Set((environment?.protection_rules ?? []).filter((rule) => rule.type === 'required_reviewers').flatMap((rule) => rule.reviewers ?? []).filter(Boolean));
  const approved = (approvals ?? []).filter((item) => item.state === 'approved'
    && (item.environments ?? []).some((target) => target.name === APPROVAL_ENVIRONMENT));
  if ((approvals ?? []).some((item) => item.state === 'rejected')) fail('this run has a rejected environment review.');
  const approvers = approved.map((item) => item.user?.login).filter((login) => login && reviewers.has(login));
  if (approvers.length === 0) fail(`no approval of ${APPROVAL_ENVIRONMENT} by a configured required reviewer is recorded for this run.`);
  return approvers;
}
