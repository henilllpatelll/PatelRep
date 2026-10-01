#!/usr/bin/env node
/**
 * Repository-side migration safety guard. Supabase remains the migration engine;
 * this checks the immutable release baseline before Supabase is invoked.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const FILENAME_PATTERN = /^(?<version>\d{3,})_(?<name>[a-z0-9][a-z0-9_-]*)\.sql$/;
const DESTRUCTIVE_PATTERN = /\b(?:DROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA|FUNCTION|POLICY|INDEX)|TRUNCATE\b|DELETE\s+FROM\b|ALTER\s+(?:TABLE|TYPE)\b[^;]*\b(?:DROP|RENAME|TYPE)\b)/i;

export function parseMigrationFilename(filename) {
  const match = filename.match(FILENAME_PATTERN);
  if (!match?.groups) return null;
  return { filename, version: match.groups.version, name: match.groups.name };
}

export function sha256(content) {
  return createHash('sha256').update(String(content).replace(/\r\n/g, '\n')).digest('hex');
}

export function loadMigrations(migrationDirectory) {
  return readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => {
      const parsed = parseMigrationFilename(entry.name);
      const content = readFileSync(resolve(migrationDirectory, entry.name), 'utf8');
      return { filename: entry.name, content, checksum: sha256(content), ...parsed };
    })
    .sort((left, right) => left.filename.localeCompare(right.filename));
}

export function checkMigrations({ migrations, releasedMigrations }) {
  const violations = [];
  const notices = [];
  const released = releasedMigrations ?? {};
  const releasedNames = new Set(Object.keys(released));
  const migrationByName = new Map(migrations.map((migration) => [migration.filename, migration]));

  for (const migration of migrations) {
    if (!migration.version) {
      violations.push(`Malformed migration filename: ${migration.filename}`);
      continue;
    }
    if (released[migration.filename] && released[migration.filename] !== migration.checksum) {
      violations.push(`Released migration modified: ${migration.filename}`);
    }
  }

  for (const filename of releasedNames) {
    if (!migrationByName.has(filename)) {
      violations.push(`Released migration deleted: ${filename}`);
    }
  }

  const releasedVersions = Object.keys(released)
    .map(parseMigrationFilename)
    .filter(Boolean)
    .map((migration) => Number(migration.version));
  const highestReleasedVersion = Math.max(0, ...releasedVersions);
  const byVersion = new Map();
  for (const migration of migrations.filter((item) => item.version)) {
    const bucket = byVersion.get(migration.version) ?? [];
    bucket.push(migration);
    byVersion.set(migration.version, bucket);
  }

  for (const [version, matchingMigrations] of byVersion) {
    if (matchingMigrations.length < 2) continue;
    const names = matchingMigrations.map((migration) => migration.filename).join(', ');
    const containsNewMigration = matchingMigrations.some(
      (migration) => !releasedNames.has(migration.filename),
    );
    if (containsNewMigration) {
      violations.push(`New migration identifier collision (${version}): ${names}`);
    } else {
      notices.push(`KNOWN HISTORICAL CONDITION — identifier collision (${version}): ${names}`);
    }
  }

  for (const migration of migrations.filter((item) => !releasedNames.has(item.filename))) {
    if (!migration.version) continue;
    if (Number(migration.version) <= highestReleasedVersion) {
      violations.push(
        `New migration must use an identifier greater than ${highestReleasedVersion}: ${migration.filename}`,
      );
    }
    if (DESTRUCTIVE_PATTERN.test(migration.content)) {
      const reviewed = /--\s*migration-safety:\s*destructive-reviewed\s*$/im.test(migration.content);
      const rollbackPlan = /--\s*rollback-plan:\s*\S+/im.test(migration.content);
      if (!reviewed || !rollbackPlan) {
        violations.push(
          `Destructive migration requires -- migration-safety: destructive-reviewed and -- rollback-plan: <plan>: ${migration.filename}`,
        );
      } else {
        notices.push(`DESTRUCTIVE MIGRATION REVIEWED — ${migration.filename}`);
      }
    }
  }

  return { violations, notices, highestReleasedVersion };
}

function main() {
  const argumentsByName = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    argumentsByName.set(process.argv[index], process.argv[index + 1]);
  }
  const migrationDirectory = resolve(argumentsByName.get('--migration-dir') ?? 'supabase/migrations');
  const manifestPath = resolve(argumentsByName.get('--manifest') ?? 'supabase/migration-manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`Migration manifest is missing: ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const result = checkMigrations({
    migrations: loadMigrations(migrationDirectory),
    releasedMigrations: manifest.migrations,
  });
  console.log(`Migration files: ${loadMigrations(migrationDirectory).length}`);
  console.log(`Immutable baseline: ${Object.keys(manifest.migrations ?? {}).length}`);
  for (const notice of result.notices) console.log(notice);
  if (result.violations.length > 0) {
    for (const violation of result.violations) console.error(`NEW MIGRATION SAFETY VIOLATION — ${violation}`);
    process.exit(1);
  }
  console.log('Migration integrity: PASS');
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
