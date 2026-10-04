#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUPABASE_CLI = 'supabase@2.112.0';
const REPLAY_DIR = join(tmpdir(), 'patelrep-migration-replay');

function run(command, argumentsList) {
  const result = spawnSync(command, argumentsList, { stdio: 'inherit', shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The real supabase/migrations/ directory contains grandfathered historical
// identifier collisions (039/042/110 — see docs/DATABASE_MIGRATIONS.md) that
// Supabase's local migration tracker cannot replay from zero. Build a
// normalized, ephemeral replay workspace (unique synthetic versions,
// repository order preserved, byte-identical SQL) and rebuild against that
// instead of the real directory.
run('node', ['scripts/build-migration-replay-workspace.mjs', '--out', REPLAY_DIR]);
run('npx', ['--yes', SUPABASE_CLI, 'start', '--workdir', REPLAY_DIR, '--exclude', 'studio,imgproxy,logflare,vector,edge-runtime']);
run('npx', ['--yes', SUPABASE_CLI, 'db', 'reset', '--local', '--workdir', REPLAY_DIR]);
run('node', ['scripts/db-contracts.mjs']);
console.log('Clean Supabase rebuild and schema-contract verification completed.');
