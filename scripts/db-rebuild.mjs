#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const SUPABASE_CLI = 'supabase@2.76.8';

function run(command, argumentsList) {
  const result = spawnSync(command, argumentsList, { stdio: 'inherit', shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('npx', ['--yes', SUPABASE_CLI, 'start', '--exclude', 'studio,imgproxy,logflare,edge-runtime']);
run('npx', ['--yes', SUPABASE_CLI, 'db', 'reset', '--local']);
run('node', ['scripts/db-contracts.mjs']);
console.log('Clean Supabase rebuild and schema-contract verification completed.');
