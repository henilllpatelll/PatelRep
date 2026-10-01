import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  getProtectedProductionBranches,
  isProtectedProductionBranch,
} from './ship.mjs';

const hookPath = fileURLToPath(new URL('../.githooks/pre-push', import.meta.url));

function bashExecutable() {
  if (process.platform !== 'win32') return 'bash';
  const programFiles = [process.env.ProgramW6432, process.env.ProgramFiles, 'C:\\Program Files'].filter(Boolean);
  return programFiles
    .flatMap((root) => [join(root, 'Git', 'bin', 'bash.exe'), join(root, 'Git', 'usr', 'bin', 'bash.exe')])
    .find((candidate) => existsSync(candidate)) ?? 'bash';
}

const bash = bashExecutable();

test('ship blocks default protected production branches', () => {
  const protectedBranches = getProtectedProductionBranches('');

  assert.equal(isProtectedProductionBranch('main', protectedBranches), true);
  assert.equal(isProtectedProductionBranch('master', protectedBranches), true);
  assert.equal(isProtectedProductionBranch('feat/release-safety', protectedBranches), false);
});

test('ship supports explicitly configured protected production branches', () => {
  const protectedBranches = getProtectedProductionBranches('main, production,release');

  assert.equal(isProtectedProductionBranch('production', protectedBranches), true);
  assert.equal(isProtectedProductionBranch('release', protectedBranches), true);
});

test('pre-push blocks a refspec that targets main from any local branch', () => {
  const result = spawnSync(bash, [hookPath], {
    encoding: 'utf8',
    env: { ...process.env, PROTECTED_PRODUCTION_BRANCHES: 'main,master' },
    input: 'refs/heads/feat/example abcdef refs/heads/main 123456\n',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /direct push to protected branch 'main'/);
});

test('pre-push allows a feature branch destination', () => {
  const result = spawnSync(bash, [hookPath], {
    encoding: 'utf8',
    env: { ...process.env, PROTECTED_PRODUCTION_BRANCHES: 'main,master' },
    input: 'refs/heads/feat/example abcdef refs/heads/feat/example 123456\n',
  });

  assert.equal(result.status, 0);
});
