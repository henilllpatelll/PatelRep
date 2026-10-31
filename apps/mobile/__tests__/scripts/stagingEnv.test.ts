import fs from 'fs';
import path from 'path';

// CommonJS guard shared with `npm run start:staging` (it runs under plain node, so it cannot be TypeScript).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const staging = require('../../scripts/staging-env.js') as {
  ANON_KEY_PLACEHOLDER: string;
  STAGING_API_URL: string;
  STAGING_SUPABASE_REF: string;
  STAGING_SUPABASE_URL: string;
  buildStagingEnv: (source?: Record<string, string | undefined>) => Record<string, string>;
  validateStagingEnv: (env: Record<string, string>) => string[];
};

const MOBILE_ROOT = path.resolve(__dirname, '../..');
const PRODUCTION_REF = 'oacnwalhcpqdabivweki';

// Unsigned test JWT: the guard reads claims only, it never verifies a signature.
const jwt = (claims: Record<string, unknown>) =>
  ['{"alg":"HS256","typ":"JWT"}', JSON.stringify(claims), 'x']
    .map((part, i) => (i === 2 ? part : Buffer.from(part).toString('base64url')))
    .join('.');

const anon = (ref: string, role = 'anon') => jwt({ iss: 'supabase', ref, role });
const envWith = (key: string | undefined) => staging.buildStagingEnv({ STAGING_SUPABASE_ANON_KEY: key });

describe('staging dev environment guard', () => {
  it('accepts the staging URLs with a staging anon key', () => {
    expect(staging.validateStagingEnv(envWith(anon(staging.STAGING_SUPABASE_REF)))).toEqual([]);
  });

  it('fixes the URLs itself, so a caller cannot redirect it', () => {
    const env = staging.buildStagingEnv({
      STAGING_SUPABASE_ANON_KEY: 'k',
      EXPO_PUBLIC_API_URL: 'https://noble-cooperation-production.up.railway.app/v1',
      EXPO_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
    });
    expect(env.EXPO_PUBLIC_API_URL).toBe(staging.STAGING_API_URL);
    expect(env.EXPO_PUBLIC_SUPABASE_URL).toBe(staging.STAGING_SUPABASE_URL);
    expect(env.APP_ENV).toBe('staging');
  });

  it('refuses a missing key and the eas.json placeholder', () => {
    expect(staging.validateStagingEnv(envWith(undefined)).join(' ')).toMatch(/anon key is not set/);
    expect(staging.validateStagingEnv(envWith(staging.ANON_KEY_PLACEHOLDER)).join(' ')).toMatch(/anon key is not set/);
  });

  it('refuses the production project key even when the URLs are staging', () => {
    expect(staging.validateStagingEnv(envWith(anon(PRODUCTION_REF))).join(' ')).toMatch(/PRODUCTION Supabase project/);
  });

  it('refuses a key from any other project', () => {
    expect(staging.validateStagingEnv(envWith(anon('someotherproject'))).join(' ')).toMatch(/does not belong to the staging/);
  });

  it('refuses a service_role key and a non-JWT value', () => {
    expect(staging.validateStagingEnv(envWith(anon(staging.STAGING_SUPABASE_REF, 'service_role'))).join(' ')).toMatch(/only "anon"/);
    expect(staging.validateStagingEnv(envWith('not-a-jwt')).join(' ')).toMatch(/not a JWT/);
  });

  it('refuses any value that references a production host', () => {
    const env = { ...envWith(anon(staging.STAGING_SUPABASE_REF)), EXTRA: 'https://noble-cooperation-production.up.railway.app' };
    expect(staging.validateStagingEnv(env).join(' ')).toMatch(/EXTRA references a production host/);
  });

  it('never echoes the key in a message', () => {
    const key = anon(PRODUCTION_REF, 'service_role');
    expect(staging.validateStagingEnv(envWith(key)).join(' ')).not.toContain(key);
  });
});

describe('eas.json staging-dev profile', () => {
  const eas = JSON.parse(fs.readFileSync(path.join(MOBILE_ROOT, 'eas.json'), 'utf8'));
  const profile = eas.build['staging-dev'];

  it('is an internal Android development-client APK with no update channel', () => {
    expect(profile.developmentClient).toBe(true);
    expect(profile.distribution).toBe('internal');
    expect(profile.android.buildType).toBe('apk');
    expect(profile).not.toHaveProperty('channel');
  });

  it('points only at staging and holds no real key', () => {
    expect(profile.env.APP_ENV).toBe('staging');
    expect(profile.env.EXPO_PUBLIC_API_URL).toBe(staging.STAGING_API_URL);
    expect(profile.env.EXPO_PUBLIC_SUPABASE_URL).toBe(staging.STAGING_SUPABASE_URL);
    expect(profile.env.EXPO_PUBLIC_SUPABASE_ANON_KEY).toBe(staging.ANON_KEY_PLACEHOLDER);
    expect(JSON.stringify(profile)).not.toMatch(/oacnwalhcpqdabivweki|noble-cooperation|eyJ/);
  });

  it('leaves the other profiles untouched in kind: only staging-dev sets APP_ENV', () => {
    for (const name of ['development', 'preview', 'production']) {
      expect(eas.build[name].env.APP_ENV).toBeUndefined();
    }
  });

  it('exposes the launcher through package scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(MOBILE_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['start:staging']).toBe('node scripts/staging-env.js start');
    expect(pkg.scripts['check:staging-env']).toBe('node scripts/staging-env.js check');
  });
});
