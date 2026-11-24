// Developer Harness V3 (D3.2) — deterministic policy evaluator.
//
// PURE: no AI call, no network, no clock, no file or environment read, no side effect. Decisions are structured with reason codes.
// Every error path denies. The evaluator never reads authority from the request: the request is the UNTRUSTED part (what is being
// asked); identity, task authority, environment, candidate facts, the proposed successor policy and the pinned policy come from the
// TRUSTED part, which only the trusted controller/verifier can construct.
//
//   evaluate({ policy, request, trusted, evidence, now, ledger }) -> Decision
//
// D3.2 ships the evaluator and its contract. It is not wired to any hook, workflow or runtime, and the shipped contract has no active
// safeguarded action, so any real safeguarded request is reported with ACTIVATION.NOT_ACTIVE plus a dry-run requirement summary.
import { checkShape, digestOf, isPlainObject, v } from '../lib/canonical.mjs'
import { matchesAny, normalizeRepoPath } from '../lib/paths.mjs'
import { IDENTITIES, isLoadedPolicy } from './contract.mjs'
import { EvidenceLedger, isSatisfying, validateEvidence } from './evidence.mjs'
import { classifyMigrationChanges } from './migration-facts.mjs'
import { promotionCheck } from './policy-version.mjs'
import { checkCredentialEnvironment, checkLauncherControlled, checkLaunchAuthentication, checkSpend } from './spend.mjs'

export const DECISION_SCHEMA = 'patelrep.developer-harness-v3.decision'
const ISOLATION_PROPERTIES = Object.freeze({ egress_restricted: true, host_mounts: false, docker_socket_exposed: false, windows_interop: false, controller_reachable: false,
  other_credentials_present: false })
const CONTROL_PLANE_GLOBS = ['.github/**', '.claude/**', 'scripts/**', '.githooks/**']

const REQUEST_SPEC = {
  required: { action: v.id, task_id: v.id },
  optional: { claimed_identity: v.str, claimed_policy_revision: v.str, claimed_candidate_sha: v.str, params: isPlainObject },
}
const PARAMS_SPEC = {
  optional: { paths: v.arrayOf(v.str, 2000), permission_mode: v.oneOf('default', 'bypass'), incremental_usd: (x) => Number.isFinite(x), purchase: v.bool,
    credential_scope: v.str, customer_agent_effect: v.bool,
    resource_id: v.id },
}
const TRUSTED_ENV_SPEC = { required: { id: v.id, kind: v.oneOf('isolated_vm', 'windows_host', 'github_hosted', 'unknown'), worker_env_names: v.arrayOf(v.str, 2000) },
  optional: { env_value_origins: isPlainObject, ...Object.fromEntries(Object.keys(ISOLATION_PROPERTIES).map((k) => [k, v.bool])) } }
const CANDIDATE_SPEC = { required: { source: v.oneOf('git'), repository: v.repo, base_sha: v.sha40, candidate_sha: v.sha40, tree_digest: v.sha40, patch_digest: v.sha64,
  changes: v.arrayOf((x) => isPlainObject(x) && /^[AMDTUXRC]$/.test(x.status) && typeof x.path === 'string' && Object.keys(x).length === 2, 5000),
  base_migrations: v.arrayOf((x) => typeof x === 'string', 20000), added_lines: isPlainObject, special_modes: v.arrayOf((x) => typeof x === 'string', 5000), origin_matches: (x) => x === null || typeof x === 'boolean', problems: v.arrayOf((x) => typeof x === 'string', 50) } }
const RESOURCE_SPEC = (r) => isPlainObject(r) && v.id(r.owner_task_id) && v.oneOf('process', 'container', 'cache', 'migration')(r.kind) && v.oneOf('idle', 'stale', 'exited', 'running')(r.lifecycle)
const TASK_SPEC = { required: { task_id: v.id, fencing_token: v.int, state_revision: v.int, authority: isPlainObject }, optional: { author_context_id: v.id } }

const deny = (codes, extra = {}) => decision('deny', codes, extra)
function decision(kind, codes, extra = {}) {
  return { schema: DECISION_SCHEMA, decision: kind, action_class: null, verified: false, reason_codes: [...new Set(codes)].sort(), missing_evidence: [], rejected_evidence: [], accepted_evidence: [],
    consumes: [], validated: [], dry_run: { requirements_met: false }, policy_revision: null, request_digest: null, ...extra }
}

/** Never throws. */
export function evaluate(input) {
  try {
    // Snapshot every untrusted/trusted structure ONCE: later checks cannot observe different values (no getter or proxy tricks).
    const { policy, ledger, now } = input
    return evaluateInner({ policy, ledger, now, request: structuredClone(input.request), trusted: structuredClone(input.trusted), evidence: structuredClone(input.evidence ?? []) })
  } catch { return deny(['EVALUATOR.INTERNAL_ERROR']) }
}

function evaluateInner({ policy, request, trusted, evidence = [], now, ledger = null }) {
  if (!isLoadedPolicy(policy) || !v.sha64(policy.revision) || !policy.contract || !policy.trusted_keys) return deny(['POLICY.NOT_LOADED'])
  const base = { policy_revision: policy.revision }
  const bad = (codes, extra = {}) => deny(codes, { ...base, ...extra })
  if (!Number.isFinite(now)) return bad(['INPUT.MALFORMED:now'])
  if (checkShape(request, REQUEST_SPEC, 'request').length) return bad(['INPUT.MALFORMED:request'])
  if (request.params !== undefined && checkShape(request.params, PARAMS_SPEC, 'params').length) return bad(['INPUT.MALFORMED:params'])
  if (!isPlainObject(trusted) || !IDENTITIES.includes(trusted.identity) || checkShape(trusted.task, TASK_SPEC, 'task').length) return bad(['INPUT.MALFORMED:trusted'])
  if (trusted.environment !== undefined && checkShape(trusted.environment, TRUSTED_ENV_SPEC, 'environment').length) return bad(['INPUT.MALFORMED:environment'])
  if (trusted.candidate != null && checkShape(trusted.candidate, CANDIDATE_SPEC, 'candidate').length) return bad(['INPUT.MALFORMED:candidate'])
  if (trusted.resources !== undefined && !(isPlainObject(trusted.resources) && Object.values(trusted.resources).every(RESOURCE_SPEC))) return bad(['INPUT.MALFORMED:resources'])
  if (!Array.isArray(evidence) || evidence.length > 64) return bad(['INPUT.MALFORMED:evidence'])
  const codes = []
  const requestDigest = digestOf(request)
  base.request_digest = requestDigest

  const params = request.params ?? {}
  const c = policy.contract
  const action = c.actions[request.action]
  if (!Object.hasOwn(c.actions, request.action) || !action) return bad(['ACTION.UNKNOWN'])
  base.action_class = action.class
  if (action.class === 'prohibited') return bad([`ACTION.PROHIBITED:${request.action}`])
  // Facts the gatherer could not fully establish are not facts: refuse rather than decide on partial data.
  if (trusted.candidate != null) {
    if (trusted.candidate.problems.length) codes.push('FACTS.INCOMPLETE')
    if (trusted.candidate.origin_matches !== true) codes.push('FACTS.ORIGIN_UNVERIFIED')
    if (trusted.candidate.special_modes.length) codes.push('PATH.SPECIAL_FILE_MODE')
  }

  // Claims made by the requester can only be checked against trusted facts; they never select or override anything.
  if (request.task_id !== trusted.task.task_id) codes.push('TASK.MISMATCH')
  if (request.claimed_identity !== undefined && request.claimed_identity !== trusted.identity) codes.push('IDENTITY.CLAIM_MISMATCH')
  if (request.claimed_policy_revision !== undefined && request.claimed_policy_revision !== policy.revision) codes.push('POLICY.CLAIMED_REVISION_REJECTED')
  if (request.claimed_candidate_sha !== undefined && request.claimed_candidate_sha !== trusted.candidate?.candidate_sha) codes.push('CANDIDATE.CLAIM_MISMATCH')
  if (!action.identities.includes('*') && !action.identities.includes(trusted.identity)) codes.push(`IDENTITY.NOT_PERMITTED:${trusted.identity}`)
  if (params.permission_mode === 'bypass' && trusted.environment?.kind !== 'isolated_vm') codes.push('ENV.BYPASS_OUTSIDE_ISOLATION')

  const extraEvidence = new Set()
  const candidate = trusted.candidate ?? null
  const authority = trusted.task.authority
  const paths = []
  let subject = null

  let pathsLoaded = false
  const ensurePaths = () => { if (!pathsLoaded) { pathsLoaded = true; loadPaths() } }
  const isEdit = request.action === 'edit_files_in_task_worktree' || request.action === 'commit_to_task_branch'
  const loadPaths = () => {
    // The requester's declared paths are advisory; whenever trusted candidate facts exist they are checked too.
    const raw = [...(isEdit ? params.paths ?? [] : []), ...(candidate?.changes?.map((x) => x.path) ?? [])]
    if (isEdit && !params.paths) { codes.push('INPUT.PATHS_REQUIRED'); return }
    if (!isEdit && !candidate) { codes.push('FACTS.MISSING'); return }
    const seen = new Map()
    for (const r of raw) {
      const n = normalizeRepoPath(r)
      if (!n.ok) { codes.push(n.code); continue }
      if (seen.has(n.key) && seen.get(n.key) !== n.path) codes.push('PATH.CASE_COLLISION_AMBIGUOUS')
      seen.set(n.key, n.path); paths.push(n)
    }
  }
  /** Normalized candidate paths for the pattern checks; an invalid path is a denial here too, never silently dropped. */
  let changedNorm = null
  const changed = () => {
    if (changedNorm) return changedNorm
    changedNorm = []
    for (const x of candidate.changes) { const n = normalizeRepoPath(x.path); if (n.ok) changedNorm.push(n); else codes.push(n.code) }
    return changedNorm
  }

  for (const check of action.checks ?? []) {
    switch (check) {
      case 'path_validity': ensurePaths(); break
      case 'scope': {
        ensurePaths() // order-independent: a reordered check list can never make `scope` pass vacuously
        const allowed = authority.allowed_paths; const denied = authority.denied_paths ?? []
        if (!v.arrayOf(v.str)(allowed) || !allowed.length || !v.arrayOf(v.str)(denied)) { codes.push('SCOPE.NO_TASK_AUTHORITY'); break }
        const out = paths.filter((p) => !matchesAny(allowed, p.path) || matchesAny(denied, p.path))
        if (out.length) codes.push('SCOPE.OUT_OF_SCOPE', ...out.slice(0, 5).map((p) => `SCOPE.OUT_OF_SCOPE:${p.path}`))
        break
      }
      case 'candidate_binding': {
        if (!candidate || candidate.source !== 'git') codes.push('FACTS.MISSING')
        break
      }
      case 'protected_paths': {
        if (!candidate) { codes.push('FACTS.MISSING'); break }
        // Migration paths are judged by the `migrations` check (historical edits are violations there), not by this generic rule.
        const migDir = `${c.migrations.directory.toLowerCase()}/`
        const norm = changed().filter((n) => !n.key.startsWith(migDir))
        if (norm.some((n) => matchesAny(c.root_of_trust_paths, n.path))) codes.push('ROOT_OF_TRUST.OWNER_CEREMONY_REQUIRED')
        else if (norm.some((n) => matchesAny(c.protected_paths, n.path))) {
          if (authority.protected_paths_authorized !== true) codes.push('PROTECTED_PATH.NOT_AUTHORIZED_BY_TASK')
          extraEvidence.add('independent_review'); extraEvidence.add('security_review')
        }
        break
      }
      case 'control_plane_self_change': {
        if (!candidate) { codes.push('FACTS.MISSING'); break }
        const norm = changed()
        if (norm.some((n) => matchesAny([...CONTROL_PLANE_GLOBS, ...c.root_of_trust_paths], n.path))) {
          // Evidence requirements always come from the ACTIVE policy, never from the candidate's own tree.
          if (authority.control_plane_authorized !== true) codes.push('CONTROL_PLANE.NOT_AUTHORIZED_BY_TASK')
          extraEvidence.add('independent_review'); extraEvidence.add('security_review')
        }
        break
      }
      case 'migrations': {
        if (!candidate) { codes.push('FACTS.MISSING'); break }
        const m = classifyMigrationChanges({ directory: c.migrations.directory, filePattern: c.migrations.file_pattern, baseFiles: candidate.base_migrations, changes: candidate.changes })
        codes.push(...m.violations.map((x) => x.code))
        if (m.newMigrations.length) {
          if (trusted.target_tip_sha !== candidate.base_sha) codes.push('MIGRATION.BASE_NOT_CURRENT')
          if (authority.migrations_authorized !== true) codes.push('MIGRATION.NOT_AUTHORIZED_BY_TASK')
          extraEvidence.add('independent_review'); extraEvidence.add('security_review')
        }
        break
      }
      case 'customer_agent': {
        if (!candidate) { codes.push('FACTS.MISSING'); break }
        if (params.customer_agent_effect === true) codes.push('CUSTOMER_AGENT.ACTIVATION_DECLARED')
        const norm = changed()
        if (norm.some((n) => matchesAny(c.customer_agent.path_globs, n.path))) extraEvidence.add('security_review')
        const must = c.customer_agent.tripwire_all.map((p) => new RegExp(p, 'i'))
        for (const lines of Object.values(candidate.added_lines ?? {})) {
          // Linear-time heuristic on bounded lines; it can only ADD a denial.
          if (lines.some((l0) => { const l = l0.slice(0, 4000); return must.every((re) => re.test(l)) && /\b(true|enabled|on|1)\b/i.test(l) && /\b(update|insert|upsert|set|default)\b/i.test(l) })) { codes.push('CUSTOMER_AGENT.ACTIVATION_TRIPWIRE'); break }
        }
        break
      }
      case 'credentials_env': {
        const isLaunch = ['launch_claude_session', 'start_bypass_permissions_session'].includes(request.action)
        const settingsEnv = isLaunch ? Object.keys(trusted.launch?.settings?.env ?? {}) : []
        const names = isLaunch ? (trusted.launch ? [...(trusted.launch.env_names ?? []), ...settingsEnv] : undefined) : trusted.environment?.worker_env_names
        const origins = isLaunch ? trusted.launch?.env_value_origins : trusted.environment?.env_value_origins
        if (!names) codes.push('ENV.UNKNOWN')
        else { codes.push(...checkCredentialEnvironment(names, c)); codes.push(...checkLauncherControlled(names, origins, settingsEnv, c)) }
        break
      }
      case 'credential_scope': {
        const scope = params.credential_scope
        if (!scope || !Object.hasOwn(c.credential_scopes, scope)) codes.push('CREDENTIAL.UNKNOWN_SCOPE')
        else if (!c.credential_scopes[scope].identities.includes(trusted.identity)) codes.push('CREDENTIAL.SCOPE_NOT_PERMITTED')
        else for (const e of c.credential_scopes[scope].required_evidence) extraEvidence.add(e)
        break
      }
      case 'spend': codes.push(...checkSpend({ incrementalUsd: params.incremental_usd ?? 0, purchase: params.purchase === true }, c)); break
      case 'launch_environment': {
        const l = trusted.launch
        codes.push(...checkLaunchAuthentication({ envNames: l?.env_names ?? [], settings: l?.settings ?? {}, auth: l?.auth ?? null }, c))
        if (!l) codes.push('AUTH.UNVERIFIED')
        break
      }
      case 'environment_isolation': {
        const e = trusted.environment
        if (!e || e.kind !== 'isolated_vm') { codes.push('ENV.NOT_ISOLATED'); break }
        for (const [k, want] of Object.entries(ISOLATION_PROPERTIES)) if (e[k] !== want) codes.push(`ENV.ISOLATION_PROPERTY_UNPROVEN:${k}`)
        break
      }
      case 'resource_ownership': {
        // Ownership, kind and lifecycle come from the controller's registry, never from the request (which can only name a resource).
        if (!params.resource_id) { codes.push('INPUT.RESOURCE_REQUIRED'); break }
        const r = trusted.resources && Object.hasOwn(trusted.resources, params.resource_id) ? trusted.resources[params.resource_id] : null
        if (!r) { codes.push('RESOURCE.UNKNOWN'); break }
        if (r.owner_task_id !== trusted.task.task_id) codes.push('RESOURCE.NOT_OWNED')
        if (r.kind === 'migration') codes.push('RESOURCE.ACTIVE_MIGRATION')
        if (r.lifecycle === 'running') codes.push('RESOURCE.UNSAFE_LIFECYCLE')
        break
      }
      case 'promotion': {
        if (!trusted.proposed_policy) { codes.push('PROMOTION.PROPOSAL_MISSING'); break }
        const pc = promotionCheck(policy, trusted.proposed_policy)
        codes.push(...pc.codes)
        subject = pc.proposedRevision
        // The proposal must be the contract inside the exact candidate the reviews and tests are bound to (derived by the controller, never by the requester).
        if (!candidate || trusted.proposed_policy_source_tree !== candidate.tree_digest) codes.push('PROMOTION.PROPOSAL_NOT_FROM_CANDIDATE')
        break
      }
      case 'evidence_validity': break
      default: codes.push('CHECK.UNKNOWN')
    }
  }

  // ── evidence ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const required = [...new Set([...(action.required_evidence ?? []), ...extraEvidence])]
  const needsEvidence = required.length > 0 || request.action === 'accept_evidence'
  const accepted = []; const rejected = []; const consumes = []; const missing = []; const validated = []
  if (needsEvidence) {
    const ev = { policy, now, task: trusted.task, authorContextId: trusted.task.author_context_id ?? null,
      // For a promotion every review and test is ALSO bound to the successor revision, so reviews of some other commit cannot be paired with this proposal.
      extraBinds: request.action === 'promote_policy' ? { independent_review: ['subject_policy_revision'], security_review: ['subject_policy_revision'], test_results: ['subject_policy_revision'] } : {}, binding: {
      repository: candidate?.repository ?? authority.repository, base_sha: candidate?.base_sha ?? authority.base_sha, candidate_sha: candidate?.candidate_sha,
      tree_digest: candidate?.tree_digest, patch_digest: candidate?.patch_digest, policy_revision: policy.revision, environment_id: trusted.environment?.id,
      subject_policy_revision: subject ?? undefined, authority_digest: digestOf(authority) } }
    if (!(ledger instanceof EvidenceLedger) && (request.action === 'accept_evidence' || required.some((t) => c.evidence_types[t]?.single_use))) codes.push('LEDGER.REQUIRED')
    const digests = new Map()
    const staged = []
    for (const env of evidence) {
      const r = validateEvidence(env, ev)
      const id = env?.payload?.evidence_id
      if (!r.ok) { rejected.push({ evidence_id: typeof id === 'string' ? id : null, codes: r.problems }); continue }
      const prior = digests.get(env.payload.nonce)
      if (prior !== undefined && prior !== r.digest) { rejected.push({ evidence_id: id, codes: ['EVIDENCE.NONCE_REUSE'] }); staged.push({ nonce: env.payload.nonce, poison: true }); continue }
      if (prior === r.digest) continue // byte-identical duplicate in one request is idempotent
      digests.set(env.payload.nonce, r.digest)
      const st = ledger ? ledger.nonceStatus(env.payload.nonce, r.digest) : 'new'
      if (st === 'conflict') { rejected.push({ evidence_id: id, codes: ['EVIDENCE.NONCE_REUSE'] }); continue }
      const single = c.evidence_types[r.payload.evidence_type].single_use
      if (single && ledger?.isConsumed(id)) { rejected.push({ evidence_id: id, codes: ['EVIDENCE.REPLAYED'] }); continue }
      staged.push({ payload: r.payload, id, single, digest: r.digest })
    }
    const poisoned = new Set(staged.filter((s) => s.poison).map((s) => s.nonce))
    const good = staged.filter((s) => !s.poison && !poisoned.has(s.payload.nonce))
    for (const s of staged.filter((x) => !x.poison && poisoned.has(x.payload.nonce))) rejected.push({ evidence_id: s.id, codes: ['EVIDENCE.NONCE_REUSE'] })
    const byType = new Map()
    for (const g of good) { if (!byType.has(g.payload.evidence_type)) byType.set(g.payload.evidence_type, []); byType.get(g.payload.evidence_type).push(g) }
    for (const type of required) {
      const have = byType.get(type) ?? []
      const ok = have.filter((g) => isSatisfying(g.payload))
      if (!ok.length) { codes.push(have.length ? `EVIDENCE.NOT_PASSING:${type}` : `EVIDENCE.MISSING:${type}`); missing.push(type); continue }
      for (const g of ok) { accepted.push(g.id); if (g.single) consumes.push(g.id) }
    }
    const ctxIds = ['independent_review', 'security_review'].map((t) => (byType.get(t) ?? []).filter((g) => isSatisfying(g.payload)).map((g) => g.payload.context_id))
    if (required.includes('independent_review') && required.includes('security_review') && ctxIds[0].some((x) => ctxIds[1].includes(x))) codes.push('EVIDENCE.REVIEW_CONTEXTS_NOT_DISTINCT')
    if (request.action === 'accept_evidence') {
      if (rejected.length) codes.push('EVIDENCE.REJECTED_PRESENT')
      if (!good.length) codes.push('EVIDENCE.NONE_ACCEPTED')
      for (const g of good) { accepted.push(g.id) }
    }
    for (const g of good) validated.push({ evidence_id: g.id, nonce: g.payload.nonce, digest: g.digest })
  }

  const detail = { missing_evidence: [...new Set(missing)], rejected_evidence: rejected, accepted_evidence: [...new Set(accepted)], consumes: [...new Set(consumes)], validated }
  if (codes.length) return bad(codes, detail)
  if (action.class === 'allowed') return decision('allow', ['ALLOWED'], { ...base, ...detail, dry_run: { requirements_met: true } })
  // safeguarded: every requirement is met; it executes only if the policy activates it.
  if (!(c.activation.active_actions ?? []).includes(request.action)) return bad([`ACTIVATION.NOT_ACTIVE:${request.action}`], { ...detail, dry_run: { requirements_met: true } })
  return decision('allow', ['SAFEGUARDED_VERIFIED'], { ...base, ...detail, verified: true, dry_run: { requirements_met: true } })
}
