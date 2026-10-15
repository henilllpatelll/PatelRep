import fs from 'fs';
import path from 'path';

import { DEFAULT_API_BASE } from '@/lib/api/client';

jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: jest.fn(), refreshSession: jest.fn() } } }));

const MOBILE_ROOT = path.resolve(__dirname, '../../..');
const REPO_ROOT = path.resolve(MOBILE_ROOT, '../..');
const RETIRED_HOSTS = ['stellar-integrity-production-30cf.up.railway.app'];

const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(MOBILE_ROOT, file), 'utf8'));

// The canonical production API host lives in the release tooling; derive it instead of duplicating it.
const canonicalApiHost = () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'scripts/production-runtime-identity.mjs'), 'utf8');
  const match = source.match(/export const PRODUCTION_API_URL = '([^']+)'/);
  if (!match) throw new Error('PRODUCTION_API_URL not found in scripts/production-runtime-identity.mjs');
  return match[1].replace(/\/$/, '');
};

describe('mobile production API URL', () => {
  const expected = `${canonicalApiHost()}/v1`;
  const eas = readJson('eas.json');

  it('DEFAULT_API_BASE targets the canonical production API under /v1', () => {
    expect(DEFAULT_API_BASE).toBe(expected);
  });

  it('EAS preview and production builds target the canonical production API', () => {
    expect(eas.build.preview.env.EXPO_PUBLIC_API_URL).toBe(expected);
    expect(eas.build.production.env.EXPO_PUBLIC_API_URL).toBe(expected);
  });

  it('.env.example targets the canonical production API', () => {
    const env = fs.readFileSync(path.join(MOBILE_ROOT, '.env.example'), 'utf8');
    const lines = env.split(String.fromCharCode(10)).map((line) => line.trim());
    expect(lines).toContain(`EXPO_PUBLIC_API_URL=${expected}`);
  });

  it('development builds keep the local emulator API', () => {
    expect(eas.build.development.env.EXPO_PUBLIC_API_URL).toBe('http://10.0.2.2:8000/v1');
  });

  it('no active mobile config references a retired Railway host', () => {
    const files = ['eas.json', '.env.example', 'app.json', 'lib/api/client.ts'];
    for (const file of files) {
      const content = fs.readFileSync(path.join(MOBILE_ROOT, file), 'utf8');
      for (const host of RETIRED_HOSTS) expect(content).not.toContain(host);
    }
  });
});
