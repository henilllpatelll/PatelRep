/**
 * Behavioural negative tests for the Staging Candidate privileged steps that hold the staging database URL or the
 * service-role key. The REAL run: commands are extracted from the workflow and executed against a layout in which the
 * candidate checkout (an ordinary feature PR) carries malicious versions of every file those steps used to execute:
 * scripts/schema-contracts.sql, the fixture seed, the feature-flag writer, the registry checker and a package.json
 * postinstall hook. Trusted main's benign copies sit in .trusted-control-plane. Nothing may ever run from the candidate.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import test from 'node:test'

const workflow = readFileSync('.github/workflows/staging-candidate.yml', 'utf8')
const prepareJob = workflow.slice(workflow.indexOf('  prepare-staging-database:'), workflow.indexOf('  deploy-api:'))
const steps = prepareJob.split(/\n      - /).slice(1).map((text) => `- ${text}`)

const slash = (path) => path.replaceAll('\\', '/')

function parseStep(text) {
  const lines = text.split('\n')
  const name = text.match(/name: (.+)/)?.[1]
  const workingDirectory = text.match(/working-directory: (.+)/)?.[1]?.trim() ?? ''
  const runIndex = lines.findIndex((line) => /^\s{8}run:/.test(line))
  let run = ''
  if (runIndex >= 0) {
    const inline = lines[runIndex].replace(/^\s{8}run:\s*/, '')
    if (inline === '|') {
      for (const line of lines.slice(runIndex + 1)) {
        if (/^\s{10}/.test(line)) run += `${line.slice(10)}\n`
        else if (line.trim() !== '') break
      }
    } else run = inline
  }
  const env = {}
  const envIndex = lines.findIndex((line) => /^\s{8}env:/.test(line))
  if (envIndex >= 0) {
    for (const line of lines.slice(envIndex + 1)) {
      const match = line.match(/^\s{10}([A-Z_]+): (.*)$/)
      if (!match) break
      env[match[1]] = match[2].replace(/^'(.*)'$/, '$1')
    }
  }
  return { name, workingDirectory, run, env }
}

const stepNamed = (fragment) => {
  const found = steps.find((text) => text.match(/name: (.+)/)?.[1].includes(fragment))
  assert.ok(found, `step containing "${fragment}" exists`)
  return parseStep(found)
}

function layout() {
  const base = mkdtempSync(join(tmpdir(), 'trusted-exec-'))
  const workspace = join(base, 'ws')
  const trusted = join(workspace, '.trusted-control-plane')
  const bin = join(base, 'bin')
  const proof = join(base, 'proof.log')
  for (const directory of [bin, join(workspace, 'scripts'), join(workspace, 'apps/web/e2e/fixtures'), join(workspace, 'apps/web/scripts'),
    join(trusted, 'scripts'), join(trusted, 'apps/web/e2e/fixtures'), join(trusted, 'apps/web/scripts')]) mkdirSync(directory, { recursive: true })
  writeFileSync(proof, '')

  const canary = (name) => `import { writeFileSync } from 'node:fs'; import { join } from 'node:path'; writeFileSync(join(process.env.CANARY_DIR, 'CANARY-${name}'), 'exfiltrated ' + (process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''))\n`
  const witness = (name) => `import { appendFileSync } from 'node:fs'; appendFileSync(process.env.PROOF_LOG, JSON.stringify({ ran: '${name}', cwd: process.cwd().replaceAll('\\\\', '/'), argv: process.argv.slice(2) }) + '\\n')\n`

  // The ordinary feature PR's malicious copies.
  writeFileSync(join(workspace, 'scripts/schema-contracts.sql'), '-- CANDIDATE-MALICIOUS\ndrop schema public cascade;\n')
  writeFileSync(join(workspace, 'apps/web/e2e/fixtures/seed-staging-tenant.mjs'), canary('seed'))
  writeFileSync(join(workspace, 'apps/web/scripts/apply-feature-flag.mjs'), canary('flag'))
  writeFileSync(join(workspace, 'scripts/check-feature-flag-registry.mjs'), canary('registry'))
  writeFileSync(join(workspace, 'apps/web/package.json'), JSON.stringify({
    name: 'candidate-web',
    scripts: { postinstall: 'node -e "require(\'fs\').writeFileSync(process.env.CANARY_DIR + \'/CANARY-install\', \'x\')"', 'seed:staging-fixture': 'node e2e/fixtures/seed-staging-tenant.mjs' },
  }))

  // Trusted main's benign copies.
  writeFileSync(join(trusted, 'scripts/schema-contracts.sql'), '-- TRUSTED-CONTRACTS\nselect 1;\n')
  writeFileSync(join(trusted, 'apps/web/e2e/fixtures/seed-staging-tenant.mjs'), witness('seed'))
  writeFileSync(join(trusted, 'apps/web/scripts/apply-feature-flag.mjs'), witness('flag'))
  writeFileSync(join(trusted, 'scripts/check-feature-flag-registry.mjs'), witness('registry'))
  writeFileSync(join(trusted, 'apps/web/package.json'), JSON.stringify({ name: 'trusted-web' }))

  writeFileSync(join(bin, 'psql'), '#!/usr/bin/env bash\n{ echo "psql pwd=$PWD"; for ((i=1;i<=$#;i++)); do if [ "${!i}" = "--file" ]; then j=$((i+1)); echo "FILE-CONTENT: $(cat "${!j}")"; fi; done; } >> "$PROOF_LOG"\n')
  writeFileSync(join(bin, 'npm'), '#!/usr/bin/env bash\necho "npm pwd=$PWD args=$*" >> "$PROOF_LOG"\ncase " $* " in *" --ignore-scripts "*) exit 0;; esac\n[ -f package.json ] && node -e \'const p=require("./package.json");const c=p.scripts&&p.scripts.postinstall;if(c)require("child_process").execSync(c,{stdio:"inherit"})\'\nexit 0\n')
  chmodSync(join(bin, 'psql'), 0o755)
  chmodSync(join(bin, 'npm'), 0o755)
  return { base, workspace, trusted, bin, proof }
}

function execute(h, { run, workingDirectory = '', env = {} }) {
  const expressions = (text) => text
    .replace(/\$\{\{\s*github\.workspace\s*\}\}/g, slash(h.workspace))
    .replace(/\$\{\{\s*github\.run_id\s*\}\}/g, '1')
    .replace(/\$\{\{\s*needs\.resolve-candidate\.outputs\.flags_csv\s*\}\}/g, 'engineering_pm_v2')
    .replace(/\$\{\{\s*secrets\.(\w+)\s*\}\}/g, 'secret-$1')
    .replace(/\$\{\{\s*vars\.(\w+)\s*\}\}/g, 'var-$1')
    .replace(/\$\{\{[^}]*\}\}/g, 'x')
  const resolved = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, expressions(value)]))
  const result = spawnSync('bash', ['-c', expressions(run)], {
    cwd: workingDirectory ? join(h.workspace, workingDirectory) : h.workspace,
    encoding: 'utf8',
    env: { ...process.env, ...resolved, PATH: `${h.bin}${delimiter}${process.env.PATH}`, PROOF_LOG: slash(h.proof), CANARY_DIR: slash(h.workspace) },
  })
  return result
}

const canaries = (h) => readdirSync(h.workspace).filter((name) => name.startsWith('CANARY-'))
const proofOf = (h) => readFileSync(h.proof, 'utf8')

const PRIVILEGED_STEPS = [
  'Verify schema contracts (trusted copy)',
  'Grant staging fixture service access',
  'Install trusted fixture dependencies',
  'Seed deterministic synthetic hotel fixture (trusted script)',
  "Enable this PR's required feature flags",
]

test('control: the OLD candidate-run commands WOULD have executed the malicious PR files (the harness detects them)', (t) => {
  const h = layout()
  t.after(() => rmSync(h.base, { recursive: true, force: true }))
  execute(h, { run: 'psql --set ON_ERROR_STOP=1 "x" --file scripts/schema-contracts.sql' })
  execute(h, { run: 'cd apps/web && npm ci' })
  execute(h, { run: 'cd apps/web && node e2e/fixtures/seed-staging-tenant.mjs', env: { SUPABASE_SERVICE_ROLE_KEY: 'secret-service-role' } })
  execute(h, { run: 'node apps/web/scripts/apply-feature-flag.mjs' })
  execute(h, { run: 'node scripts/check-feature-flag-registry.mjs --key k' })
  assert.match(proofOf(h), /CANDIDATE-MALICIOUS/)
  assert.deepEqual(canaries(h).sort(), ['CANARY-flag', 'CANARY-install', 'CANARY-registry', 'CANARY-seed'])
})

test('NEGATIVE: a malicious ordinary feature PR (SQL, seed, flag writer, registry checker, postinstall) never executes in any privileged step', (t) => {
  const h = layout()
  t.after(() => rmSync(h.base, { recursive: true, force: true }))
  for (const fragment of PRIVILEGED_STEPS) {
    const step = stepNamed(fragment)
    assert.equal(step.workingDirectory.split('/')[0], '.trusted-control-plane', `${fragment} runs in the trusted checkout`)
    const result = execute(h, step)
    assert.equal(result.status, 0, `${fragment}: ${result.stderr}`)
  }
  assert.deepEqual(canaries(h), [], 'no candidate-controlled code ran: no canary was written and no key exfiltrated')
  const proof = proofOf(h)
  assert.match(proof, /TRUSTED-CONTRACTS/, 'the schema contracts come from trusted main')
  assert.doesNotMatch(proof, /CANDIDATE-MALICIOUS|drop schema/)
  const trustedRoot = slash(h.trusted)
  const working = [...proof.matchAll(/pwd=(\S+)/g)].map((match) => match[1])
  const executions = proof.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line))
  assert.deepEqual(executions.map((entry) => entry.ran), ['seed', 'registry', 'flag'], 'trusted seed, registry check and flag writer each ran once')
  for (const cwd of [...working, ...executions.map((entry) => entry.cwd)]) {
    assert.ok(slash(cwd).startsWith(trustedRoot) || /\/trusted-exec-[^/]+\/ws\/\.trusted-control-plane/.test(slash(cwd)), `${cwd} is inside the trusted checkout`)
  }
})

test('NEGATIVE: dependency installation for the privileged job uses the trusted lockfile and never runs lifecycle scripts', (t) => {
  const h = layout()
  t.after(() => rmSync(h.base, { recursive: true, force: true }))
  const install = stepNamed('Install trusted fixture dependencies')
  assert.match(install.run, /npm ci --ignore-scripts/)
  assert.equal(install.workingDirectory, '.trusted-control-plane/apps/web')
  assert.equal(Object.keys(install.env).length, 0, 'no secret is present while dependencies install')
  // Even if the trusted package.json ever gained an install hook, --ignore-scripts neuters it; and the PR's hook is never reached.
  writeFileSync(join(h.trusted, 'apps/web/package.json'), JSON.stringify({ scripts: { postinstall: 'node -e "require(\'fs\').writeFileSync(process.env.CANARY_DIR + \'/CANARY-trusted-hook\', \'x\')"' } }))
  assert.equal(execute(h, install).status, 0)
  assert.deepEqual(canaries(h), [])
  assert.match(proofOf(h), /--ignore-scripts/)
})

test('NEGATIVE: only data crosses the boundary -- the candidate registries are passed as read-only file arguments', () => {
  const flags = stepNamed("Enable this PR's required feature flags")
  assert.match(flags.run, /check-feature-flag-registry\.mjs --python "\$CANDIDATE_WORKSPACE\/apps\/api\/core\/feature_registry\.py" --typescript "\$CANDIDATE_WORKSPACE\/apps\/web\/lib\/featureRegistry\.ts" --key "\$key"/)
  assert.equal(flags.env.TENANT_SLUG, 'patelrep-staging-fixture', 'flags can only be written for the synthetic fixture tenant')
  assert.equal(flags.env.ENABLED, 'true')
  const seed = stepNamed('Seed deterministic synthetic hotel fixture (trusted script)')
  assert.match(seed.run, /^node apps\/web\/e2e\/fixtures\/seed-staging-tenant\.mjs\s*$/)
  assert.doesNotMatch(prepareJob, /cd apps\/web|npm run seed:staging-fixture/, 'the privileged job never enters or installs the candidate web app')
  assert.equal((prepareJob.match(/npm ci/g) ?? []).length, 1, 'the only npm install in the privileged job is the trusted --ignore-scripts one')
})

test('the trusted control plane is re-verified immediately before the service-role key is used', () => {
  const reverify = prepareJob.indexOf('Re-verify the trusted control plane before using the service-role key')
  const install = prepareJob.indexOf('Install trusted fixture dependencies')
  const seed = prepareJob.indexOf('Seed deterministic synthetic hotel fixture')
  const flags = prepareJob.indexOf("Enable this PR's required feature flags")
  assert.ok(install > 0 && reverify > install && seed > reverify && flags > seed)
  assert.ok(existsSync('apps/web/package-lock.json'), 'a lockfile exists for the trusted npm ci')
})
