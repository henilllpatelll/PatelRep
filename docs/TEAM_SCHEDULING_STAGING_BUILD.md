# Staging-only Android development build

How to get the PR #185 mobile app onto a real Android device **talking only to staging**, for the device QA in
[TEAM_SCHEDULING_DEVICE_QA.md](TEAM_SCHEDULING_DEVICE_QA.md) and the smoke scenarios in
[TEAM_SCHEDULING_STAGING_SMOKE.md](TEAM_SCHEDULING_STAGING_SMOKE.md).

**Status: configured, not built.** No EAS build has been started for this, nothing has been uploaded, and no quota has been
spent. A build is started only on the owner's explicit approval (section 5).

## 1. What was added

| Item | Purpose |
| --- | --- |
| `eas.json` profile `staging-dev` | Android `apk`, `developmentClient: true`, internal distribution, **no update channel** (it can never receive an OTA update), env `APP_ENV=staging` plus the staging API and Supabase URLs |
| `scripts/staging-env.js` | Pins the staging URLs, refuses any key that is not the **staging** project's `anon` key, then runs `expo start --dev-client` |
| `npm run check:staging-env`, `npm run start:staging` | The two entry points of that script |
| `__tests__/scripts/stagingEnv.test.ts` | Unit tests for the guard and the profile (the profile never mentions production) |

The existing `development`, `preview` and `production` profiles are unchanged. Note for awareness: `development` pairs a
local-emulator API (`10.0.2.2:8000`) with the **production** Supabase URL, which is why it must not be used for this QA.

## 2. The important design fact: the build does not decide the backend

A development-client APK contains no app JavaScript. The JS is bundled by Metro on the developer's machine, and Metro inlines
`EXPO_PUBLIC_*` at that moment. Consequences:

- The `env` block of `staging-dev` documents intent and is a second line of defence, but it is **not** what points the app at
  staging. `npm run start:staging` is.
- A developer's local `apps/mobile/.env` (which holds production values per `.env.example`) would otherwise win. The launcher
  therefore sets the variables in the process environment itself (a `.env` file does not override an already-set variable),
  so it cannot be bypassed by a stale file or shell variable.
- Verified locally (2026-10-29, no build, no network call to any backend): with a temporary `apps/mobile/.env` holding the
  production values on disk, the Android bundle served by `npm run start:staging` defined `EXPO_PUBLIC_API_URL` and
  `EXPO_PUBLIC_SUPABASE_URL` as the staging URLs and carried a staging-project `anon` key; the production Supabase project
  ref and the `.env` key appeared nowhere in it. (The production API host still appears once as the unused
  `DEFAULT_API_BASE` fallback constant.) Not verified: behaviour of an installed APK, which needs the build.
- `lib/api/client.ts` falls back to the **production** API when `EXPO_PUBLIC_API_URL` is unset. Never start Metro for this
  app by any route other than `npm run start:staging` while testing against staging.
- The anon key in the profile is the placeholder `SET_STAGING_ANON_KEY_BEFORE_BUILD` on purpose. It never needs to be
  replaced or committed: the build does not use it, and if it were used the app would fail to sign in rather than reach
  production. The real key goes only into the shell variable below.

## 3. Environment variables

| Variable | Where it is set | Value | Secret? |
| --- | --- | --- | --- |
| `APP_ENV` | `eas.json` (profile) and the launcher | `staging` | no |
| `EXPO_PUBLIC_API_URL` | `eas.json` and the launcher (fixed) | `https://patelrep-api-staging-staging.up.railway.app/v1` | no |
| `EXPO_PUBLIC_SUPABASE_URL` | `eas.json` and the launcher (fixed) | `https://vhxymynoutzamtfourop.supabase.co` | no |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the launcher, from the next row | staging project's `anon` key | public by design (ships in every APK), still not committed |
| `STAGING_SUPABASE_ANON_KEY` | **your shell only**, before `npm run start:staging` | Supabase dashboard > staging project > Settings > API > `anon` `public` | do not paste into chat or commit |

Never use a `service_role` key: the guard rejects any key whose role is not `anon`, any key whose project ref is not
`vhxymynoutzamtfourop`, and any value that contains a production host (`oacnwalhcpqdabivweki.supabase.co`,
`noble-cooperation-production.up.railway.app`). Test accounts and their shared password come from the staging fixture
(`apps/web/e2e/fixtures/seed-staging-tenant.mjs`, password from the repository's `staging` environment secret
`STAGING_FIXTURE_PASSWORD`); no credential is stored in this repository.

## 4. Quota and cost

- One EAS cloud build is one build against the Expo plan of the project owner (`henilllpatelll`, project
  `0fc41a33-8e3c-40cf-9114-26dc0b95d044`). The monthly allowance and queue priority depend on that plan and are **not
  recorded in the repository**; check `https://expo.dev/accounts/henilllpatelll/settings/billing` before approving. On a
  free plan builds queue at low priority, so expect a wait.
- A failed build still counts. This would be the first development-client build on Expo SDK 58 (the last recorded EAS
  build notes predate the SDK 58 upgrade, #184), so a first-attempt native failure is plausible.
- The native build is reusable: JavaScript changes reload from Metro and need no rebuild. A new build is needed only when
  native dependencies, `app.json` plugins or permissions change.
- `eas build --local` spends no cloud quota but is not supported on Windows (macOS/Linux, or WSL with the Android SDK and
  JDK), so it is not a realistic option on this machine.
- Source upload: `eas build` uploads the project archive (respecting `.easignore` / `.gitignore`) to Expo. The archive holds
  no secrets as long as `apps/mobile/.env*` stays ignored (it is) and `google-services.json` is the one already committed.
- Expo's per-build artifacts expire; delete the build in the dashboard when QA ends.

## 5. Exact commands (run only after approval)

From `apps/mobile/` with the branch checked out and committed (EAS builds the committed tree):

```bash
npx eas-cli@latest build --profile staging-dev --platform android
```

It will print a build URL and a QR code. Do not pass `--auto-submit`, and do not run `eas update`.

Expected outcome: an `.apk` signed with the project's existing EAS-managed Android keystore (the same one as `preview`).

## 6. Installation and first run

1. On the device allow installs from your browser or file manager. **Uninstall any PatelRep app first**: the package id is
   `com.patelrep.app` for every variant (changing it would break `google-services.json` and push), and a differently-signed
   install of the same package is refused. This also keeps a production install off the test device.
2. Open the build URL or scan the QR on the device and install the APK.
3. On your computer, in `apps/mobile/`, with the key in the shell:
   ```bash
   # bash
   export STAGING_SUPABASE_ANON_KEY='<staging anon key>'
   npm run check:staging-env    # must print "Staging configuration OK"
   npm run start:staging
   ```
   ```powershell
   $env:STAGING_SUPABASE_ANON_KEY = '<staging anon key>'
   npm run check:staging-env
   npm run start:staging
   ```
4. Open the installed app. It shows the development launcher: choose the Metro server (same Wi-Fi), or enter
   `http://<computer LAN IP>:8081`. Add `-- --tunnel` to the start command only if the network blocks LAN access.
5. Confirm before testing: the API `/health` reports `environment: staging` and the expected PR SHA. **The mobile app has no
   on-screen environment indicator** (the `STAGING` header exists only in the web app), so the signals are: the guard output,
   `/health`, and that only staging fixture accounts (`*@patelrep.test`) can sign in.
6. Sign in with a staging fixture account. Allow notifications when asked, so a push device is registered.

## 7. Stop conditions

Stop and ask the owner if any of these happen: `/health` is not `staging`; sign-in succeeds with an account that is not a
staging fixture; the guard prints a production warning; any request in the Metro log goes to a host other than the staging
API or staging Supabase.

## 8. Cleanup

Uninstall the app, stop Metro, unset `STAGING_SUPABASE_ANON_KEY`, delete the EAS build, and note the run in the device QA log.
