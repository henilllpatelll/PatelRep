# Developer Harness V3 — 15 Isolation Acceptance (D3.3)

## Verdict for the current candidate (`753f4216`, closure `a5431547…`): `PASS` — 13 of 13 scenarios (run 5, 2026-11-25, WHPX)

**Isolation acceptance PASSED for the current trusted code**, on the first run taken after the owner reviewed and re-pinned the D-3 fix. `dh3 doctor` reads the persisted record as `ISOLATION.ACCEPTANCE: PASS`, and its `acceptanceStatus` check would report `STALE` if the closure, golden image or probe version differed from the recorded run. History, kept in full: run 2 passed 13/13 for the previous closure `c1605655…` and went `STALE` at the first re-pin. Runs 3 and 4 (closure `d97c7d3b…`) each failed scenario 9 with `S9.HOST_CPU_CONTENDED` because the host sampler returned no value for some host-CPU samples. The D-3 remediation (`62f6a40f`, reviewed and pinned by the owner) retries only samples that could not be measured, records every attempt and its error, and leaves the rule itself (three finite samples in every burn, each at most 70 %) unchanged. Run 5 is the first run on that closure. Details are in "Run 5" below.

This is the D3.3 isolation acceptance for the **exact trusted code under review**. It does not activate V3. It does not resolve the activation gates in 17 §3 or the limits below.

| Run | When / accel | Suite version | Verdict | Evidence (copied byte-for-byte from `%LOCALAPPDATA%\PatelRep\dh3\evidence\runs\`) |
|---|---|---|---|---|
| 1 | 2026-11-24T23:39Z, WHPX | probe v1, in-module verdicts | **FAIL** (scenarios 2, 10) | [`evidence/isolation-acceptance-run1-20261124T233915Z.json`](evidence/isolation-acceptance-run1-20261124T233915Z.json), kept unchanged |
| — | 2026-11-25T00:36Z, WHPX | probe v2 (uncommitted remediation draft) | `NOT_RUN`: the Resource Governor refused admission (`MEMORY_HEADROOM_INSUFFICIENT`); no VM was started | [`evidence/isolation-acceptance-notrun-20261125T003628Z.json`](evidence/isolation-acceptance-notrun-20261125T003628Z.json) (sha256 `a722d5ac…4d09`) |
| 2 | 2026-11-25T07:35:35Z → 07:38:33Z, WHPX | probe v3 + host-side evaluators (`isolation/acceptance-rules.mjs`), candidate `b7bbae10`, closure `c1605655…` | **PASS** (13/13) for that closure; **`STALE` for the current candidate** | [`evidence/isolation-acceptance-run2-20261125T073535Z.json`](evidence/isolation-acceptance-run2-20261125T073535Z.json) (sha256 `056d7cc66de0ab31cf35cdad722b727303b65dba2b2058186d3510ae795e9184`, identical to the host's `isolation-acceptance.json` at the time) |
| 3 | 2026-11-25T09:01:38Z → 09:04:39Z, WHPX | same probe v3 and rules; candidate `180d5a23`, closure `d97c7d3b…`; reused golden image | **FAIL** (12/13; scenario 9 `S9.HOST_CPU_CONTENDED`) | [`evidence/isolation-acceptance-run3-fail-20261125T090138Z.json`](evidence/isolation-acceptance-run3-fail-20261125T090138Z.json) (sha256 `7d0c1e958eaaf23e1913973b989060184dd2e46d5809e1625d2d964b560210dc`) |
| 4 | 2026-11-25T09:05:10Z → 09:08:24Z, WHPX | identical code, image and host as run 3 (one retry, nothing changed in between) | **FAIL** (12/13; scenario 9 `S9.HOST_CPU_CONTENDED`) | [`evidence/isolation-acceptance-run4-fail-20261125T090510Z.json`](evidence/isolation-acceptance-run4-fail-20261125T090510Z.json) (sha256 `4d347f1f571ff783565e466e164daad75fb039cd3996b060220dae75e79f3164`; was the host's `isolation-acceptance.json` until run 5) |
| 5 | 2026-11-25T21:28:50Z → 21:31:18Z, WHPX | probe v3, sampler-retry code from `62f6a40f` (host sampler v1 evidence); candidate `753f4216`, closure `a5431547…`; reused golden image | **PASS** (13/13) | [`evidence/isolation-acceptance-run5-pass-20261125T212850Z.json`](evidence/isolation-acceptance-run5-pass-20261125T212850Z.json) (sha256 `81efc14d1214a38ce494724fa8501d7b91e5ce43e56ecc45561dc27d70fc4129`, identical to the host's `runs/isolation-acceptance-20261125T212850Z.json` and to its current `isolation-acceptance.json`) |

### Run 5 (current candidate)

| Fact | Value |
|---|---|
| Candidate | git HEAD `753f42168d346638d681c89dd3fa4c0572b26bdd`, equal to the remote branch head when the run started; `closure_differs_from_head: false`. Closure: 40 files, digest `a54315478e7d48dfa995b5b8afab79b236bd485882e3cc28195bf7b7cd8fad44`. The owner reviewed D-3 source commit `62f6a40f779b8de3cb150c065119dbb9be8edb70` (three modified privileged files, hashes matched the reviewed digests) and re-pinned from that immutable commit |
| Golden image | **reused, not rebuilt.** The sealed image was re-hashed by the run: sha256 `be8f7e394180c31c15173abaa4557739f7d4daa7cf5253d920c0d61a88e9e230`, `golden_sha256_recorded == golden_sha256_now`. The image is the one provisioned at 2026-11-25T07:35:23Z; base image sha512 `76488ba3…`, Claude 2.1.331 sha512 `2a8d02df…`, `guest_hardening` v1 (vsock and binfmt disabled) unchanged. Scenario 13 again confirmed it read-only |
| Runtime | QEMU 11.1.3, `-accel whpx`, 2 vCPU on 20 logical CPUs, CPU cap 40 % (normal) and 5 % (binding). **VM RAM 768 MB, Job Object memory limit 1280 MB**: the Resource Governor admitted a smaller probe VM than in runs 2 to 4 (1024 MB / 1536 MB) because less host memory was free at the time (about 3.7 to 4 GB available). The memory rule is unchanged (guest OOM kill, QEMU alive, working set below the Job limit); the limit it was judged against was 1280 MB. The validated argv hash is `01fa05ba…1092` |
| Scenarios | 1–13 all `PASS`, `probe_error: null` |

Scenario 9 in run 5 (read from the preserved record):

| Observation | Value | Rule |
|---|---|---|
| Guest allocation | OOM-killed (137), QEMU alive, working set 829 MB | must end in OOM kill with QEMU alive, below the Job limit (1280 MB): **met** |
| Host memory / responsiveness | min available 2849 MB, 7/7 samples responsive | **met** |
| Job Object read-back | `flags 5`, rate 4000 (normal) and 500 (capped) | hard cap in force: **met** |
| QEMU host CPU share, normal / capped | 9.8 % / 5.1 % | capped ≤ 6.25 %, normal clearly above the binding cap: **met** |
| Work per guest CPU-second, capped / normal | 0.583 | ≤ 0.75 (expected 0.5): **met** |
| **Host CPU samples, normal burn** | **`[33.6, 19.0, 30.2]`**: 3 finite values | exactly 3 finite samples, each ≤ 70 %: **met** |
| Host CPU samples, capped burn | `[18.4, 11.8, 15.0]` | **met** |

Sampler-attempt diagnostics (both burns, preserved unchanged in the evidence file under `scenarios.9.evidence.cpu.{normal,capped}.host_cpu_sampling`): 6 attempts in total, one per slot, **all `accepted` on the first attempt**. Every attempt has `error: null`, `exit_code: 0`, `counter_problems: {}`, `host_responsive: true`, `sampler_ms` 2195–2231 (above the 900 ms floor), a timeout of 8000 ms, and start and end offsets inside the 8–30 s window of the 40 s burn (the guest burn ended at 40261 and 40268 ms). `stop_reason` is `null` for both. Each attempt also recorded its `available_mb` (2849–3291 MB, far above the 1024 MB floor). No attempt carried an `unverified_*` value because none failed. The evaluator's host-side check of this evidence (`hostSamplingProblems`) returned no problem.

What run 5 does and does not show about D-3:

* It shows the pinned code takes three finite samples per burn and that the new evidence records every attempt. All six attempts succeeded on their first try, so **the retry path was not exercised live**; it is covered by `tests/d33-sampler-retry.test.mjs`.
* It does **not** prove why runs 3 and 4 returned `null` samples. Those runs recorded no sampler error code, and the cause stays unproven. If it recurs, the record now names the error (`SAMPLER.*` or `COUNTER.*`) for every attempt.
* The pass was not obtained by rerunning an unchanged closure. Runs 3 and 4 were on `d97c7d3b…`; run 5 is the first run on the reviewed, re-pinned `a5431547…`.
* Nothing was loosened: the three-finite-samples requirement, the 70 % ceiling, the 8–30 s window, the 40 s burn and the retry bound are pinned in `acceptance-rules.mjs` and all 13 scenarios were judged by the same rules as before.

### Runs 3 and 4 (previous candidate `180d5a23`, closure `d97c7d3b…`; now `STALE`)

| Fact | Value |
|---|---|
| Candidate | git HEAD `180d5a231855d8e3f2b14279160300369a60a0e1` (same as the remote branch head), no closure file differing from HEAD. Closure: 40 files, digest `d97c7d3bd468b658834be9df8b6f6d988604739d5a1175442d3fbc40b8fb664e`, the digest the owner re-pinned from immutable source commit `fe7518df` |
| Golden image | **reused, not rebuilt.** Before each run the sealed image was re-hashed: sha256 `be8f7e394180c31c15173abaa4557739f7d4daa7cf5253d920c0d61a88e9e230` equals the recorded value (`golden_sha256_recorded == golden_sha256_now`). The file is read-only, the base image sha512 (`76488ba3…`) and the Claude 2.1.331 sha512 are unchanged, and `guest_hardening` v1 (vsock and binfmt disabled) is the one recorded at provisioning (2026-11-25T07:35:23Z) |
| Runtime | QEMU 11.1.3, `-accel whpx`, 1024 MB, 2 vCPU, Job Object memory limit 1536 MB, CPU cap 40 % (normal) and 5 % (binding). Only the SSH forward port and the proxy port differ from run 2, so the validated argv hash differs per run |

| Scenario | Run 3 | Run 4 |
|---|---|---|
| 1–8, 10–13 | PASS | PASS |
| 9 | **FAIL** `S9.HOST_CPU_CONTENDED` | **FAIL** `S9.HOST_CPU_CONTENDED` |

What scenario 9 showed in both runs (all read from the preserved records):

| Observation | Run 3 | Run 4 | Rule |
|---|---|---|---|
| Guest allocation | OOM-killed (137), QEMU alive, working set 1079 MB | OOM-killed (137), QEMU alive, working set 1053 MB | must end in OOM kill with QEMU alive, < 1536 MB: **met** |
| Host memory / responsiveness | min available 2128 MB, 7/7 samples responsive | min available 2654 MB, 7/7 responsive | **met** |
| Job Object read-back | `flags 5`, rate 4000 (normal) and 500 (capped) | same | hard cap in force: **met** |
| QEMU host CPU share, normal / capped | 9.6 % / 5.1 % | 9.6 % / 5.0 % | capped ≤ 6.25 %: **met** |
| Work per guest CPU-second, capped / normal | 0.541 | 0.626 | ≤ 0.75 (expected 0.5): **met** |
| **Host CPU samples during the normal burn** | **`[44, null, null]`** | **`[21.6, 19.5, null]`** | exactly 3 finite samples, each ≤ 70 %: **NOT met** |
| Host CPU samples during the capped burn | `[10.5, 12.9, 10.7]` | `[13.1, 9.8, 10.2]` | **met** |

The only unmet condition is that the normal-burn window did not yield three measured host-CPU values. `cpu_pct` is `null` when the `typeperf` sample exits non-zero or times out, or when the `% Processor Time` cell of the last row is blank or non-numeric (`host-sampler.mjs`: `runBounded`, `parseTypeperf`). Neither record stores the sampler error code, so **the cause of the missing samples is not proven**. A diagnostic reproduction of `typeperf` was refused by the session's policy and was not retried by another route. Facts that bear on it:

* `host-sampler.mjs`, the burn-window code and the scenario 9 rule are byte-identical to run 2, which obtained three finite samples. The closure changes since run 2 are the D-1/D-2 fixes (`bin/dh3.mjs`, `acceptance-rules.mjs`, `acceptance.mjs`, `subscription-probe.mjs`, `subscription-governor.mjs`) and do not touch sampling.
* The values that were measured are far below the 70 % ceiling (≤ 44 %), and every cap and memory fact held.
* The failure is therefore a host measurement gap, not evidence that the cap or limits failed. It is still counted as a FAIL: the rule exists so that an unmeasured host is never read as an idle one, and it was **not** loosened, bypassed or re-run into a pass.

**Not done at the time, deliberately:** the sampler and the rule were not changed while runs 3 and 4 were being recorded. Any change to them is a trusted-closure change that needs owner review and a new pin, after which the suite must pass on the new closure. The remediation proposed then (retry an unmeasured host-CPU sample a bounded number of times inside the burn window and record the sampler error code, keeping the three-finite-samples requirement unchanged) was implemented in `62f6a40f`, reviewed and pinned by the owner, and run 5 is the first run on it (see above).

### Run 2 identity (earlier closure `c1605655…`, now STALE)

| Fact | Value |
|---|---|
| Candidate (git HEAD) | `b7bbae10f897ac931b002c1fcce544d924a67d08`, with no closure file differing from HEAD |
| Trusted closure | 40 files, digest `c16056556904de8435e1ce8af4fbb0c546d41918d8d32efd33de5c41bf9ce89e`. Every file equals the owner-pinned digest in `docs/developer-harness-v2/bypass-scopes.json` (scope `dh3-d33`, pinned 2026-11-25) |
| Golden image | rebuilt under WHPX at 2026-11-25T07:35:23Z in 132 s (768 MB, 2 vCPU). Sealed sha256 `be8f7e39…e9230` equals the recorded and re-hashed value. `guest_hardening` v1: vsock and binfmt disabled, verified before sealing |
| Runtime | QEMU 11.1.3, `-accel whpx`, 1024 MB, 2 vCPU on 20 logical CPUs, Job Object memory limit 1536 MB, CPU cap 40 % (normal) and 5 % (binding boot). The validated argv sha256 is `adf4f536…bb5c0` |
| Claude in guest | 2.1.331, root-owned `r-xr-xr-x`, sha512 host-computed from the npm-integrity-verified package |
| Admission | the Resource Governor admitted both boots at probe size. It waited 3 minutes for headroom before provisioning (available memory 3.1–3.4 GB) |

### Run 2 results (previous closure; not the current verdict)

| # | Scenario | Key evidence (host-verified facts in **bold**) |
|---|---|---|
| 1 | no host filesystem | no host mounts; only `vda`/`vdb`; root fs ext4; runs as `worker` |
| 2 | no host binary execution | no `binfmt_misc` handlers, not mounted; PE32+ / no-extension / MZ stub → `ENOEXEC`; `#!/bin/sh` control rc 42; Windows paths `ENOENT`; **fixture structurally valid and exits 0 on the Windows host** |
| 3 | no host / LAN services | 10.0.2.2 and both LAN interfaces refused or unreachable on all 8 ports; slirp DNS times out |
| 4 | no controller access | SSH hostfwd and proxy ports refused from the guest; proxy CONNECT to loopback/controller → 403; **host proxy log: 9 denials, 1 allow (`api.anthropic.com`)** |
| 5 | default-deny egress | no resolver, no direct TCP to public IPs; proxy denies off-list hosts, port 80, IP literals (decimal and `[::1]`); positive control `api.anthropic.com:443` tunnel established; **host log corroborates** |
| 6 | no WSL / Docker neighbours | all neighbour addresses unreachable (see limits: none was running) |
| 7 | no privilege | no sockets or tools found; `sudo` exit 1; groups = `worker` |
| 8 | bounded disk | home fill hit `ENOSPC`; **task disk 24 GiB virtual, auth disk 2.7 MB on host** |
| 9 | bounded memory and CPU | guest allocation OOM-killed (exit 137); **QEMU alive, working set 1080 MB < 1536 MB limit; host ≥ 2362 MB available and responsive at all 7 samples**. CPU: work per guest CPU-second fell to 0.516 of normal under the 5 % cap (expected 0.5, max accepted 0.75); **QEMU host share 9.6 % normal vs 5.0 % capped (max accepted 6.25 %); Job read-back `flags 5`, rate 4000 / 500; host CPU ≤ 24.7 %** |
| 10 | no host channels | no virtio ports, USB or agents; `vsock` = `absent` (`EAFNOSUPPORT`, no node for root); static `vhost-*` nodes present but **not registered** by the kernel; no host-channel modules loaded; fw_cfg lists no names; 0 SMBIOS type-11 strings; **QEMU argv validated against the exact allow-list** |
| 11 | no policy / clock tampering | worker `date -s` exit 1; guest clock shifted 24 h; **host clock unaffected** |
| 12 | artifact integrity | **bundle imported (verify + fsck into a fresh bare repo); host-recomputed tree accepted; forged tree claim rejected; `gitdir:` redirect refused (`BUNDLE.BAD_HEADER`)** |
| 13 | no residue between tasks | all 9 plants confirmed before discard; no residue after; hardlink to a root file refused; sanitizer marker present; allow-listed JSON key kept, others dropped; **golden image read-only** |

Proxy decisions for the whole run: `deny EGRESS.IP_LITERAL ×4`, `deny EGRESS.HOST_NOT_ALLOWLISTED ×4`, `deny EGRESS.PORT_NOT_ALLOWED ×1`, `allow api.anthropic.com ×1`.

### Why none of run 1's 11 `PASS` rows count

Run 1 ran on the real VM, but its verdicts were decided by v1 code that this remediation found unsound:

* **Vacuous outcomes.** "Could not connect" was any `OSError` class name, so an unrecognised error counted as a PASS. Empty maps and a probe section that threw also passed. Scenario 11 passed when the probe had not run at all (`undefined !== 0`).
* **Scenario 9 CPU.** The 40 % Job Object cap could never bind on a 2-vCPU VM with 20 logical CPUs (the VM can use at most 10 %), so the cap was recorded but never shown enforced.
* **Scenario 13.** Nothing checked that the planted residue existed before the overlay was discarded.

## Run 1 failures and their remediation

| # | Run 1 observation | Root cause | Remediation (commit `b7bbae10`, owner-pinned 2026-11-25; both scenarios PASS in run 2) |
|---|---|---|---|
| 2 | `binfmt` = `python3.13`, `register`, `status`; PE exec `OSError` | Debian registers a python3.13 bytecode handler; the v1 rule failed on any entry and could not tell `ENOEXEC` from other errors | Provisioning refuses the `binfmt_misc` module and masks its units, then verifies this before sealing the image. The probe reports raw handler text and errno names. The host checks handlers against an exact allow-list. A well-formed PE32+ fixture must give `ENOEXEC` in the guest and exit 0 on the Windows host (positive control; verified on this host by the test suite). A `#!/bin/sh` positive control must run. |
| 10 | `vsock: true` | v1 reported only whether the static `/dev/vsock` node existed, which proves nothing | Provisioning refuses every vsock/VMCI/Hyper-V socket module. The probe records the kernel's own answers (`socket(AF_VSOCK)`, the local-CID ioctl, connects, datagrams), plus each channel node's owner, mode and **whether the kernel registered the device**. Debian creates static nodes (`/dev/vsock`, `kvm`, `vhost-*`) whether or not a driver loads, so only a registered node counts. The worker gets `EACCES` on the root-only `/dev/vsock`, so root's own `open()` must answer "no device". A hardened image must show `absent`. Device ids are checked against the validated QEMU argv. Root-side facts are checked too: fw_cfg `opt/` entries, SMBIOS OEM strings, and that the hardening is in effect. An image without the hardening fails. |

## Acceptance-validity rules now enforced (all scenarios)

* Guest output is untrusted data. The probe collects facts only, and every verdict is a pure host function, unit-tested against positive, negative and malformed fixtures (`tests/d33-acceptance.test.mjs`). "Pure host function" is about **parsing, not trust**: see "What rests on guest-reported facts" below.
* A scenario passes only on complete, well-formed, expected evidence with exact target coverage. A missing field, an empty map, a section exception or an unknown outcome is a FAIL.
* Positive controls: the proxy reaches `api.anthropic.com:443`; the mount table was really read; virtio net and block are visible; the exec control runs; the residue was planted.
* **Scenarios 4 and 5 are corroborated by the host.** The host proxy's own decision log for the probe window must hold at least as many denials as the 403s the guest claims. It must hold an allow for each claimed tunnel, and no allow for any host off the list.
* **Scenario 9 CPU:** a second boot runs under a cap below the VM's demand. Two independent measurements must agree:
  1. **Work per guest CPU-second of the burn workers** must drop to the level the cap predicts. Load inside the guest, such as timers catching up after boot, lowers work and CPU time together, so it cannot fake a drop.
  2. **The host-measured QEMU CPU share**, taken inside the burn, must sit at the cap when capped and clearly above it when not.

  Windows must read back the hard cap (`flags 5`, rate) for both boots. The guest must have exactly the VM's vCPUs. The host must stay at or below 70 % CPU at every one of 3 samples per burn. A sample that could not be measured may be retried (at most 3 attempts per sample, at most 2 sampler-process failures per burn, always inside the 8–30 s window and before the guest burn ends); every attempt, its error and anything it measured is recorded and judged, and a slot that is never measured stays `null` and fails as `S9.HOST_CPU_CONTENDED`. The second boot goes through the Resource Governor again.
* **Scenario 9 memory:** the guest OOM killer (or `MemoryError`) must end the allocation while QEMU stays alive. The evidence states when host memory was sampled (after the allocation and during each burn, not during the allocation itself).
* **Evidence retention, identity and privacy:**
  * Each run is written once to `runs/<started_at>.json` (exclusive create). A collision gets a suffix, and only a validated timestamp ever becomes a file name. The previous latest is archived byte for byte before it is replaced.
  * Each run records git HEAD, which git reads with an absolute binary and a clean config. It also records whether V3 paths have uncommitted changes, and the sha256 of every pinned closure file, using the pin tool's exact rule.
  * Private host addresses are masked everywhere in the document.
  * `acceptanceStatus` (in `acceptance-rules.mjs`) counts a PASS only if it came from the current probe version, golden image and closure digest. Otherwise it reports `STALE`. Defect D-1 (below) used to stop `dh3 doctor` from reaching this check. It is fixed, pinned and **verified live**: after the re-pin doctor reported run 2 as `STALE` (`TRUSTED_CODE_CHANGED`), after runs 3 and 4 it reported the persisted record's real verdict (`FAIL`), and after run 5 it reports `PASS` (`ISOLATION.ACCEPTANCE ok`, verified live).
* **Safety of the run itself:** acceptance refuses to start over a real Claude login on the auth disk, because scenario 13 deliberately wrecks that home. Host tools (`ssh`, `taskkill`, `tasklist`, `typeperf`, `git`) run only from absolute system paths, never from the agent-writable working directory. Provisioning invalidates the old record before it rebuilds the golden image, and `start` boots only a sealed (read-only) image.

### What rests on guest-reported facts

A compromised image could forge these: scenarios 1–7, the guest part of 10, 11 (worker exit code and guest clock shift), 13 (guest outputs), and 9 (guest OOM outcome and throughput).

The host verifies these independently:

* golden image sha256 and the validated QEMU argv (the real authority for `restrict=on` and the device set);
* the proxy decision log (scenarios 4 and 5);
* disk sizes (scenario 8);
* the Job Object read-back, QEMU's liveness, CPU share and working set, and host memory, CPU and responsiveness (scenario 9);
* the host clock (scenario 11), the bundle import (scenario 12), and the golden image being read-only (scenario 13);
* the fixture's validity and its Windows run (scenario 2).

The guest facts come from a fresh overlay of a sealed image before any task code runs, so the residual is a compromised golden image or provisioning.

## Known limits (not resolved by a PASS)

* Scenario 6 records whether a WSL distribution or Docker Desktop was actually running. **In run 2 none was** (`host_wsl_running_count 0`, Docker Desktop not running), so an active neighbour network was not exercised.
* Scenario 12 proves host-side artifact integrity, not binding to the D3.2 evaluator (that needs the D3.4 issuer keys).
* Scenario 10 does not cross-check the QEMU argv read from `qemu-cmdline.txt` against the live process command line. No host canary listeners back up scenarios 3 and 4.
* On another host, Defender could quarantine the unsigned PE fixture. That would be a false scenario 2 FAIL, not a security problem.
* Run 1 left a test `.claude.json` (`oauthAccount` = the worker's `id` string) on the persistent auth disk. The sanitizer keeps that key, and a real login overwrites it.
* Runs 2 to 4 used the probe-size VM (1024 MB) the governor admitted, and run 5 a 768 MB VM (the governor sized it down to the memory then free). The full 3 GB worker was not admitted on this host (3.7 to 4 GB available against the 5504 MB the governor requires; `RESOURCE.FULL_WORKER_ADMISSION` is still not ok in `dh3 doctor`), so it was never exercised.
* The host sampler's retry path has not been seen to fire on the real host: run 5 needed no retries. Its cause for the `null` samples in runs 3 and 4 is unproven (see above).
* AI-run automated test, not an external audit. QEMU still runs as the owner (O-7).

## Defects found during run 2 (fail closed) — D-1 and D-2 RESOLVED

**Status: resolved.** Fixed in `fe7518df`, re-pinned by the owner from that immutable commit (the V2 provenance patch is `180d5a23`), and verified in this session: provenance OK, 40/40 pins match (owner-reported), `dh3 doctor` reads the record (`STALE` for run 2 after the re-pin, `FAIL` after run 4), and all 228 V3 tests passed at that commit (`node --test "scripts/developer-harness-v3/tests/*.test.mjs"`, including `tests/d33-state-readers.test.mjs`; the suite is 247 tests after the D-3 fix, all passing, run sequentially on the run 5 candidate). The fix changed 5 trusted closure files, so run 2 became `STALE` as predicted, and run 3 had to be taken on the new closure (it did not pass; see above). The descriptions below record what was fixed. Fix details:

* `readJsonState` is unchanged. It still accepts only a boolean `true`.
* The new exact validators are `isAcceptanceRecord` and `isSubscriptionStateRecord`, and doctor reads through `readAcceptanceStatus`. A PASS now also needs all 13 scenarios PASS and 64-hex digests.
* The attestation is checked by `attestationStatus` (shape, v4 nonce, exact ISO round trip, at most 24 h, not in the future) and consumed exactly once. The claim is an exclusive per-nonce marker (`<state>.consumed-<nonce>`), which is never removed, so one tiny file accumulates per attestation.
* `attest-extra-usage-off` keeps the existing governor state and never overwrites an unreadable state file.
* A future `verified_at` is no longer carried forward.
* Regressions: `tests/d33-state-readers.test.mjs`.

| # | Defect (as it was before the fix) | Effect (before the fix) | Resolution |
|---|---|---|---|
| D-1 | `bin/dh3.mjs` and `isolation/subscription-probe.mjs` passed `(v) => v && v.schema` to `readJsonState`, which accepts only `validate(value) === true` | doctor always showed `ISOLATION.ACCEPTANCE NOT_RUN` and `SUBSCRIPTION.EXTRA_USAGE_VERIFIED_OFF "no record"`. `attest-extra-usage-off` could not read the earlier state, and `probe-subscription` could not read the attestation back, so owner step O-3 could not complete | **Resolved.** Exact boolean validators (`isAcceptanceRecord`, `isSubscriptionStateRecord`) and `readAcceptanceStatus`; regression tests in `tests/d33-state-readers.test.mjs`. Doctor behaviour confirmed live in this session. O-3 is no longer blocked by D-1 (it still needs the owner's login and attestation) |
| D-2 | `isolation/acceptance.mjs` prefixed `RESOURCE.` onto reason codes that already carry it | cosmetic: `RESOURCE.RESOURCE.MEMORY_HEADROOM_INSUFFICIENT` in the 00:36Z `NOT_RUN` record (kept unchanged as evidence) | **Resolved.** `admissionRefusalReason` never doubles the prefix |

## Defect D-3 (scenario 9 host-CPU sample coverage) — RESOLVED, verified by run 5

| # | Defect (as it was) | Effect (before the fix) | Resolution |
|---|---|---|---|
| D-3 | the normal-burn host-CPU samples could come back `null` (cause unproven; see "Runs 3 and 4") and the record did not keep the sampler error code | scenario 9 failed closed with `S9.HOST_CPU_CONTENDED` in runs 3 and 4 | **Resolved.** `62f6a40f` (owner-reviewed, re-pinned in `753f4216`): `sampleHostCpuWindow` takes three samples inside the 8–30 s window of the 40 s burn and retries only a sample that could not be MEASURED (at most 3 attempts per slot, at most 2 process-level failures per burn, never past the window or the burn). Every attempt is recorded with its error code, exit code and counter problems. A measured value, however adverse, is never retried away: every attempt's CPU % and available memory (including `unverified_*` values from failed runs) is judged by `hostSamplingProblems`, and nothing is ever substituted for a missing sample. The requirement of three finite samples, each at most 70 %, is unchanged. Tests: `tests/d33-sampler-retry.test.mjs`, `tests/d33-acceptance.test.mjs`. Verified live: run 5 PASS (13/13). Residual: the retry path was not exercised on the real host, and the cause of the runs 3 and 4 `null` samples remains unproven |

## Re-running acceptance

Re-run after any re-provision or any change to the trusted closure (a re-run on an unchanged closure is also legitimate, but every run is kept, passing or not):

1. `node scripts/developer-harness-v3/bin/dh3.mjs provision --wait-minutes 60`. Before sealing, provisioning confirms the guest hardening is in effect.
2. `node scripts/developer-harness-v3/bin/dh3.mjs verify-isolation`. It takes about 3 minutes under WHPX. Results land in `%LOCALAPPDATA%\PatelRep\dh3\evidence\runs\`.
3. Copy the run file into `evidence/` unchanged, record its sha256, and re-render this document from it.
