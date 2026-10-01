#!/usr/bin/env node
import { execSync, spawnSync } from 'child_process';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { createInterface } from 'readline/promises';

const AI_KEY = process.env.ANTHROPIC_API_KEY;
const DEFAULT_PROTECTED_PRODUCTION_BRANCHES = ['main', 'master'];

export function getProtectedProductionBranches(value = process.env.PROTECTED_PRODUCTION_BRANCHES) {
  const branches = (value ?? '')
    .split(',')
    .map((branch) => branch.trim())
    .filter(Boolean);

  return new Set(branches.length > 0 ? branches : DEFAULT_PROTECTED_PRODUCTION_BRANCHES);
}

export function isProtectedProductionBranch(branch, protectedBranches = getProtectedProductionBranches()) {
  return protectedBranches.has(branch);
}

async function ai(prompt) {
  if (!AI_KEY) return null;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': AI_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text.trim();
}

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function spawn(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function captureIfSuccessful(cmd, args) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return result.status === 0 ? result.stdout.trim() : null;
}

async function main() {
  const branch = run('git rev-parse --abbrev-ref HEAD');
  if (branch === 'HEAD') {
    console.error('Shipping from a detached HEAD is disabled. Check out a feature branch first.');
    process.exit(1);
  }

  if (isProtectedProductionBranch(branch)) {
    console.error(`Direct shipping from ${branch} is disabled.`);
    console.error('Create a feature branch first:');
    console.error('git checkout -b feat/<name>');
    process.exit(1);
  }

  const status = run('git status --short');
  if (!status) { console.log('Nothing to commit.'); return; }

  const diff = (run('git diff HEAD') + run('git diff --staged')).slice(0, 4000);
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // --- commit message ---
  let commitMsg = '';
  if (AI_KEY) {
    process.stdout.write('Generating commit message... ');
    commitMsg = await ai(
      `Write a git commit message for this diff. Use conventional commits (type(scope): description). Imperative mood, under 72 chars, no period at end. Return only the message, nothing else.\n\nDiff:\n${diff}`
    );
    console.log('done');
    const input = await rl.question(`  ${commitMsg}\nCommit message (Enter to accept, or type new): `);
    if (input.trim()) commitMsg = input.trim();
  } else {
    commitMsg = await rl.question('Commit message: ');
  }

  if (!commitMsg.trim()) { console.log('Aborted.'); rl.close(); return; }

  // --- stage + commit ---
  run('git add -A');
  spawn('git', ['commit', '-m', commitMsg]);

  // --- push ---
  spawn('git', ['push', '-u', 'origin', branch]);

  const existingPrUrl = captureIfSuccessful('gh', [
    'pr', 'list', '--head', branch, '--state', 'open', '--json', 'url', '--jq', '.[0].url',
  ]);
  if (existingPrUrl) {
    console.log(`Open PR already exists: ${existingPrUrl}`);
    rl.close();
    return;
  }

  // --- PR description ---
  let prBody = commitMsg;
  if (AI_KEY) {
    process.stdout.write('Generating PR description... ');
    prBody = await ai(
      `Write a 2-3 sentence GitHub PR description for this diff. Explain what changed and why. Plain prose, no bullet points, no markdown headers.\n\nDiff:\n${diff}`
    );
    console.log('done');
  }

  const prBase = process.env.SHIP_PR_BASE?.trim() || 'main';
  spawn('gh', ['pr', 'create', '--base', prBase, '--title', commitMsg, '--body', prBody]);

  rl.close();
}

const isExecutedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isExecutedDirectly) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
