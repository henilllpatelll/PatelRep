#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.SUPABASE_LOCAL_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const result = spawnSync('psql', ['--set', 'ON_ERROR_STOP=1', databaseUrl, '--file', 'scripts/schema-contracts.sql'], {
  stdio: 'inherit',
  shell: false,
});
if (result.error?.code === 'ENOENT') {
  console.error('psql is required for schema contracts. Install PostgreSQL client tools, then retry.');
  process.exit(1);
}
process.exit(result.status ?? 1);
