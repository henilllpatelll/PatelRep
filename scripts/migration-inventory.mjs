#!/usr/bin/env node
import { resolve } from 'node:path';

import { loadMigrations } from './check-migrations.mjs';

function signalsFor(content) {
  const signals = [];
  if (/\bDROP\b/i.test(content)) signals.push('DROP');
  if (/\b(?:DELETE\s+FROM|UPDATE\s+)/i.test(content)) signals.push('data change');
  if (/\bALTER\s+TABLE\b/i.test(content)) signals.push('alter table');
  if (/\bNOT\s+NULL\b/i.test(content)) signals.push('not null');
  if (/\bCREATE\s+TRIGGER\b/i.test(content)) signals.push('trigger');
  return signals.join(', ') || 'additive/other';
}

export function markdownInventory(migrations) {
  const duplicateVersions = new Set(migrations
    .filter((migration, index, all) => all.filter((item) => item.version === migration.version).length > 1)
    .map((migration) => migration.version));
  const rows = migrations.map((migration) => {
    const purpose = migration.name.replaceAll('_', ' ');
    const ordering = duplicateVersions.has(migration.version)
      ? 'KNOWN HISTORICAL COLLISION'
      : migration.version === '0201'
        ? 'Historical numeric workaround'
        : 'deterministic identifier';
    return `| ${migration.filename} | ${migration.version} | ${purpose} | ${ordering} | ${signalsFor(migration.content)} |`;
  });
  return [
    '# Migration inventory',
    '',
    'Generated from the repository SQL files. Signal labels are review cues, not SQL proof; the Docker-backed migration gate is the fresh-database execution proof.',
    '',
    '| Filename | Identifier | Inferred purpose | Ordering | Static review signals |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.stdout.write(markdownInventory(loadMigrations(resolve('supabase/migrations'))));
}
