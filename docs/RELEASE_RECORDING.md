# Production release recording (annotated tag + GitHub Release)

Recording is the last step of a production release: create the annotated `vX.Y.Z` tag on the exact deployed commit,
then the GitHub Release. It is separate from deploying and from verifying production, and it is the only thing the
**PatelRep Release Recorder** GitHub App is allowed to do.

## Root cause (runs 38185575766 and 38189513925, release `v1.9.2`)

Both runs deployed API + Web at `8e4ee88b354360754d1134d62d81b8af370b0434` and passed production verification, then
failed in `Tag and create GitHub Release`:

* Run 38185575766: `git push` of the tag was rejected by GitHub ("refusing to allow a GitHub App to create or update
  workflow ... without `workflows` permission").
* Run 38189513925 (after PR #140 moved to the Git Data API): `git.createTag` succeeded (an unreferenced tag object),
  then `POST /git/refs` returned **403 Resource not accessible by integration** with
  `x-accepted-github-permissions: contents=write; contents=write,workflows=write`.

GitHub requires the `workflows` permission to create a ref whose commit contains `.github/workflows` content that the
repository does not already hold at that base (here, a release SHA behind `main` after a workflow change). The built-in
`GITHUB_TOKEN` can **never** hold `workflows` (it is not an assignable `permissions:` key), so no change to the
workflow's own `permissions:` block can fix this; neither `git push` nor the Git Data API can work with it.

## Solution

A dedicated, single-purpose GitHub App whose installation token is minted only inside the `release-recording`
Environment, only after production verification:

| Piece | What it does |
|---|---|
| `scripts/production-release-recorder.mjs` | Pure, fail-closed policy + CLI (`preflight`, `verify`, `record`, `recover`). |
| `scripts/production-release-recorder-deps.mjs` | The only code with write calls: `POST /git/tags`, `POST /git/refs` (App token) and `gh release create --verify-tag` (workflow token). No PATCH/PUT/DELETE, no force, no `git push`. |
| `production-release.yml` → `release-recording-preflight` | Runs **before** the database migration and any deploy. Mints the App token (proving the secret, installation and both permissions work) and does one read-only call. If recording is not possible the release stops before touching production. |
| `production-release.yml` → `tag-and-release` | Unchanged position (after `verify-production-release`). Now runs the recorder in `release-recording`. |
| `production-release-record.yml` | **Record-only recovery**: records a release that already deployed and verified, without redeploying. |

### Guarantees (all enforced by `scripts/production-release-recorder*.test.mjs`)

* The App token requests exactly `contents: write` + `workflows: write`, on this one repository, and is passed only as
  `TAG_TOKEN` to the recorder, used only by the two ref-creating calls. The Release is created with the run's own
  `GITHUB_TOKEN` (`contents: write`, now granted only to the tag job; the workflow default is `contents: read`).
* App credentials exist only in the `release-recording` Environment. The `production` Environment and its Railway /
  Supabase credentials are never available to recorder jobs, and the recorder jobs never see production credentials.
* Recorder code is checked out from the workflow's own commit (`github.sha`); code from the release target is never executed.
* Before any write the recorder proves: strict `vMAJOR.MINOR.PATCH`; exact 40-hex SHA; SHA reachable from `main`; a
  successful `CI Gate` on that SHA; the version is the exact patch/minor/major successor of the newest **completed**
  Release (or the one-time bootstrap) with no conflicting higher tag, draft or prerelease.
* **An existing tag is never created over, moved, deleted or force-updated.** It is accepted only when already an
  annotated tag peeling to exactly the verified SHA (then only the Release is created: safe resume). Anything else
  throws. After creation the tag is read back and must peel to the exact SHA before the Release is attempted.
* The eligibility, SHA/tree provenance, CI/Staging, database and production-target gates are untouched; recording is
  strictly downstream of them.

### Record-only recovery (`Production Release Record`)

Manual dispatch from `main` only; shares the `production-deploy` lock so it cannot overlap a release or rollback; has no
`production` Environment and no deploy, migrate, merge, dispatch or rollback capability. Before the App token is even
minted, `verify` proves (all read-only):

1. The source run is `production-release.yml` of this repository, `workflow_dispatch` on `main`, completed, **not** successful, and its control-plane commit is on `main`.
2. Source jobs *Resolve and verify release eligibility*, *Deploy exact API release*, *Deploy exact web release* and *Verify production release identity and smoke* succeeded, and *Tag and create GitHub Release* did not.
3. The run's sanitized `production-release-evidence` ledger names exactly this SHA and version as eligible and production-verified, with every gate job `success`, and does not say the release was recorded.
4. **Production right now** serves exactly this SHA and version on both API `/health` and Web (`readProductionRuntimeIdentity`). If a later release or rollback happened, this fails closed.
5. Then the standard checks above (main ancestry, CI Gate, version integrity, existing-tag rules). The recorder re-verifies everything again immediately before writing.

## What you must configure (once)

These steps need your GitHub account; nothing here is done by the PR.

1. **Create the GitHub App** — GitHub → Settings → Developer settings → GitHub Apps → *New GitHub App*.
   * Name: `PatelRep Release Recorder`. Homepage URL: `https://github.com/henilllpatelll/PatelRep`.
   * Webhook: **uncheck Active**. No callback URL, no user authorization, no device flow.
   * Repository permissions: **Contents: Read and write**, **Workflows: Read and write** (Metadata: Read-only is added automatically). Everything else *No access*; no organization or account permissions; subscribe to no events.
   * Where can this GitHub App be installed: **Only on this account**.
   * Create it, copy the **Client ID**, then *Generate a private key* (downloads a `.pem`).
2. **Install it** — App page → *Install App* → your account → **Only select repositories** → `PatelRep`. Do not grant "All repositories".
3. **Create the Environment** — repo → Settings → Environments → *New environment* → `release-recording`.
   * Deployment branches and tags: **Selected branches and tags** → add `main` only.
   * Do **not** add required reviewers (recording must run unattended at the end of a release); the human gate is the dispatch of the release itself.
   * Environment **variable** `RELEASE_RECORDER_APP_CLIENT_ID` = the Client ID.
   * Environment **secret** `RELEASE_RECORDER_APP_PRIVATE_KEY` = the full contents of the `.pem` (including the BEGIN/END lines). Then delete the downloaded `.pem`.
   * Put these in the Environment, **not** repository-level secrets/variables.
4. **Recommended hardening (tag ruleset)** — Settings → Rules → Rulesets → *New tag ruleset*: name `release-tags`, enforcement *Active*, target tags matching `v*`; enable *Restrict creations*, *Restrict updates*, *Restrict deletions*; add the **PatelRep Release Recorder** App to the bypass list (*Always*). This makes the recorder the only identity that can create a release tag, and nobody (including the App) can move or delete one without removing the ruleset. Note it also blocks creating *any* `v*` tag by hand or from other workflows (the historical `v1.x` milestone tags are unaffected); `production-rollback.yml` only reads tags.
5. **Confirm** the App is **not** a bypass actor on the `main` branch ruleset (it has `Contents: write` and must not be able to push to `main`).

You do not need to touch the existing PatelRep App or any existing secret.

## Finalizing `v1.9.2` safely

Production already serves `v1.9.2` / `8e4ee88b354360754d1134d62d81b8af370b0434`. **Do not re-dispatch Production Release** —
that would redeploy production for no reason (and would currently compute `v1.9.2` again).

1. Review and merge this PR yourself; complete the configuration steps above.
2. Confirm nothing is recorded yet and production is unchanged:
   ```bash
   gh api repos/henilllpatelll/PatelRep/git/ref/tags/v1.9.2          # expect 404
   gh release view v1.9.2                                            # expect "release not found"
   curl -s https://noble-cooperation-production.up.railway.app/health   # release_sha 8e4ee88b..., release_version v1.9.2
   ```
3. Dispatch the record-only workflow from `main`:
   ```bash
   gh workflow run production-release-record.yml --ref main \
     -f version=v1.9.2 \
     -f release_sha=8e4ee88b354360754d1134d62d81b8af370b0434 \
     -f source_run_id=38189513925
   ```
   Watch the run: `verify` must pass before the App token step; the last step prints `Release recording: recorded`.
4. Verify: `gh release view v1.9.2`; `gh api repos/henilllpatelll/PatelRep/git/ref/tags/v1.9.2` is an annotated `tag` object whose `git/tags/<sha>` object is the commit `8e4ee88b...`. The next Production Release will compute `v1.9.3` for a patch bump.
5. Incidents #137 and #139: close them yourself once you have confirmed the Release and tag; this change neither closes nor modifies them.

If `verify` refuses (production moved on, evidence expired after 90 days, the tag already exists elsewhere), it changes nothing; do not work around it. Investigate the stated reason first.

## Residual risks

* `workflows: write` is a powerful scope; the App's blast radius is bounded by single-repo installation, the main-only `release-recording` Environment, the three recorder jobs being the only consumers, and (recommended) the tag ruleset. If the private key leaks, rotate it in the App settings and replace the Environment secret.
* The end-to-end App path can only be exercised after the human steps above; the first proof is the `release-recording-preflight` job of the next Production Release (fails before any deploy if misconfigured) or the v1.9.2 record-only run.
* Evidence ledgers are retained 90 days; record-only recovery after that requires a human decision.
