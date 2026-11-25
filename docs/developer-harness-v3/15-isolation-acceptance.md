# Developer Harness V3 — 15 Isolation Acceptance (D3.3)

## Verdict: `PASS` — all 13 scenarios passed on the real VM under WHPX (run 2, 2026-11-25)

This is the D3.3 isolation acceptance for the **exact trusted code under review**. It does not activate V3. It does not resolve the activation gates in 17 §3 or the limits below.

| Run | When / accel | Suite version | Verdict | Evidence (copied byte-for-byte from `%LOCALAPPDATA%\PatelRep\dh3\evidence\runs\`) |
|---|---|---|---|---|
| 1 | 2026-11-24T23:39Z, WHPX | probe v1, in-module verdicts | **FAIL** (scenarios 2, 10) | [`evidence/isolation-acceptance-run1-20261124T233915Z.json`](evidence/isolation-acceptance-run1-20261124T233915Z.json), kept unchanged |
| — | 2026-11-25T00:36Z, WHPX | probe v2 (uncommitted remediation draft) | `NOT_RUN`: the Resource Governor refused admission (`MEMORY_HEADROOM_INSUFFICIENT`); no VM was started | [`evidence/isolation-acceptance-notrun-20261125T003628Z.json`](evidence/isolation-acceptance-notrun-20261125T003628Z.json) (sha256 `a722d5ac…4d09`) |
| 2 | 2026-11-25T07:35:35Z → 07:38:33Z, WHPX | probe v3 + host-side evaluators (`isolation/acceptance-rules.mjs`) | **PASS** (13/13) | [`evidence/isolation-acceptance-run2-20261125T073535Z.json`](evidence/isolation-acceptance-run2-20261125T073535Z.json) (sha256 `056d7cc66de0ab31cf35cdad722b727303b65dba2b2058186d3510ae795e9184`, identical to the host's `isolation-acceptance.json`) |

### Run 2 identity

| Fact | Value |
|---|---|
| Candidate (git HEAD) | `b7bbae10f897ac931b002c1fcce544d924a67d08`, with no closure file differing from HEAD |
| Trusted closure | 40 files, digest `c16056556904de8435e1ce8af4fbb0c546d41918d8d32efd33de5c41bf9ce89e`. Every file equals the owner-pinned digest in `docs/developer-harness-v2/bypass-scopes.json` (scope `dh3-d33`, pinned 2026-11-25) |
| Golden image | rebuilt under WHPX at 2026-11-25T07:35:23Z in 132 s (768 MB, 2 vCPU). Sealed sha256 `be8f7e39…e9230` equals the recorded and re-hashed value. `guest_hardening` v1: vsock and binfmt disabled, verified before sealing |
| Runtime | QEMU 11.1.3, `-accel whpx`, 1024 MB, 2 vCPU on 20 logical CPUs, Job Object memory limit 1536 MB, CPU cap 40 % (normal) and 5 % (binding boot). The validated argv sha256 is `adf4f536…bb5c0` |
| Claude in guest | 2.1.331, root-owned `r-xr-xr-x`, sha512 host-computed from the npm-integrity-verified package |
| Admission | the Resource Governor admitted both boots at probe size. It waited 3 minutes for headroom before provisioning (available memory 3.1–3.4 GB) |

### Run 2 results

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

  Windows must read back the hard cap (`flags 5`, rate) for both boots. The guest must have exactly the VM's vCPUs. The host must stay at or below 70 % CPU at every one of 3 samples per burn. The second boot goes through the Resource Governor again.
* **Scenario 9 memory:** the guest OOM killer (or `MemoryError`) must end the allocation while QEMU stays alive. The evidence states when host memory was sampled (after the allocation and during each burn, not during the allocation itself).
* **Evidence retention, identity and privacy:**
  * Each run is written once to `runs/<started_at>.json` (exclusive create). A collision gets a suffix, and only a validated timestamp ever becomes a file name. The previous latest is archived byte for byte before it is replaced.
  * Each run records git HEAD, which git reads with an absolute binary and a clean config. It also records whether V3 paths have uncommitted changes, and the sha256 of every pinned closure file, using the pin tool's exact rule.
  * Private host addresses are masked everywhere in the document.
  * `acceptanceStatus` (in `acceptance-rules.mjs`) counts a PASS only if it came from the current probe version, golden image and closure digest. Otherwise it reports `STALE`. **Defect found after run 2:** `dh3 doctor` never reaches this check. It reads the record through a validator that returns the schema string, and `readJsonState` accepts only `true`. So doctor shows `ISOLATION.ACCEPTANCE NOT_RUN` even for a current PASS. This fails closed. See "Known defects" below.
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
* Run 2 used the probe-size VM (1024 MB) the governor admitted. The full 3 GB worker was not admitted on this host (about 3.3 GB available), so it was not exercised.
* AI-run automated test, not an external audit. QEMU still runs as the owner (O-7).

## Known defects found during run 2 (fail closed; not fixed, because fixing them changes pinned code)

Any edit to these files changes the trusted closure. That makes this PASS `STALE` and needs an owner re-pin before dh3 can run again. They were therefore left for owner review instead of being patched after the accepted run.

| # | Defect | Effect | Proposed fix |
|---|---|---|---|
| D-1 | `bin/dh3.mjs:80`, `:85`, `:205` and `isolation/subscription-probe.mjs:26` pass `(v) => v && v.schema` to `readJsonState`, which accepts only `validate(value) === true` | doctor always shows `ISOLATION.ACCEPTANCE NOT_RUN` and `SUBSCRIPTION.EXTRA_USAGE_VERIFIED_OFF "no record"`. `attest-extra-usage-off` cannot read the earlier state, so it rewrites the file from scratch. `probe-subscription` can never read the attestation back (`PROBE.OWNER_ATTESTATION_MISSING_USED_OR_EXPIRED`), so owner step O-3 cannot complete | validate with a boolean schema check, for example `(v) => v?.schema === '<expected schema>'`, and add a regression test that a written record reads back `ok` |
| D-2 | `isolation/acceptance.mjs:121` prefixes `RESOURCE.` onto reason codes that already carry it | cosmetic: `RESOURCE.RESOURCE.MEMORY_HEADROOM_INSUFFICIENT` in the 00:36Z `NOT_RUN` record | drop the extra prefix |

## Re-running acceptance

Re-run after any re-provision or any change to the trusted closure (including the D-1/D-2 fixes, once the owner has re-pinned them):

1. `node scripts/developer-harness-v3/bin/dh3.mjs provision --wait-minutes 60`. Before sealing, provisioning confirms the guest hardening is in effect.
2. `node scripts/developer-harness-v3/bin/dh3.mjs verify-isolation`. It takes about 3 minutes under WHPX. Results land in `%LOCALAPPDATA%\PatelRep\dh3\evidence\runs\`.
3. Copy the run file into `evidence/` unchanged, record its sha256, and re-render this document from it.
