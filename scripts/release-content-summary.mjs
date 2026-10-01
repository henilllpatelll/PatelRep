#!/usr/bin/env node
/**
 * Builds a concise release-content summary: PRs merged, migrations added, and
 * feature keys added since the previous release tag. Pure git/GitHub metadata
 * reads — no network calls beyond the local git repository, so this needs no
 * credentials and can run as an ordinary step in production-release.yml.
 */
import { execFileSync } from 'node:child_process'

import { extractPythonKeys } from './check-feature-flag-registry.mjs'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function tryGit(args, fallback = '') {
  try {
    return git(args)
  } catch {
    return fallback
  }
}

export function extractPrNumbers(commitMessages) {
  const numbers = new Set()
  for (const message of commitMessages) {
    const match = message.match(/\(#(\d+)\)\s*$/)
    if (match) numbers.add(Number(match[1]))
  }
  return [...numbers].sort((a, b) => a - b)
}

export function diffMigrations(nameStatusOutput) {
  return nameStatusOutput
    .split('\n')
    .filter((line) => line.startsWith('A\t') && line.includes('supabase/migrations/'))
    .map((line) => line.split('\t')[1].split('/').pop())
    .sort()
}

export function diffFeatureKeys(previousSource, targetSource) {
  const previousKeys = new Set(extractPythonKeys(previousSource))
  const targetKeys = extractPythonKeys(targetSource)
  return targetKeys.filter((key) => !previousKeys.has(key))
}

export function buildSummary({ previousTag, targetSha, prNumbers, migrations, featureKeys }) {
  const lines = [
    `## Release content: ${previousTag || '(no previous tag)'} → ${targetSha.slice(0, 7)}`,
    '',
    prNumbers.length > 0
      ? `**Merged PRs:** ${prNumbers.map((n) => `#${n}`).join(', ')}`
      : '**Merged PRs:** none detected from commit messages',
    '',
    migrations.length > 0
      ? `**New migrations:** ${migrations.join(', ')}`
      : '**New migrations:** none',
    '',
    featureKeys.length > 0
      ? `**New feature keys (deployed OFF — use Feature Rollout to enable per tenant):** ${featureKeys.join(', ')}`
      : '**New feature keys:** none',
  ]
  return lines.join('\n')
}

function main() {
  const targetSha = tryGit(['rev-parse', 'HEAD'])
  const previousTag = tryGit(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*', 'HEAD^'])

  const commitMessages = previousTag
    ? tryGit(['log', '--format=%s', `${previousTag}..${targetSha}`]).split('\n').filter(Boolean)
    : []
  const nameStatus = previousTag ? tryGit(['diff', '--name-status', `${previousTag}`, targetSha]) : ''
  const previousRegistry = previousTag
    ? tryGit(['show', `${previousTag}:apps/api/core/feature_registry.py`])
    : ''
  const targetRegistry = tryGit(['show', `${targetSha}:apps/api/core/feature_registry.py`])

  const summary = buildSummary({
    previousTag,
    targetSha,
    prNumbers: extractPrNumbers(commitMessages),
    migrations: diffMigrations(nameStatus),
    featureKeys: diffFeatureKeys(previousRegistry, targetRegistry),
  })

  console.log(summary)
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main()
