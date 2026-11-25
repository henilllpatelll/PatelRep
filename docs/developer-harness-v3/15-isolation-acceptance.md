# Developer Harness V3 — 15 Isolation Acceptance (D3.3)

## Verdict: `ISOLATION_UNPROVEN` — no acceptance run has passed

| Run | When / accel | Suite version | Verdict | Evidence |
|---|---|---|---|---|
| 1 | 2026-11-24T23:39Z, WHPX | probe v1, in-module verdicts | **FAIL** (scenarios 2, 10) | [`evidence/isolation-acceptance-run1-20261124T233915Z.json`](evidence/isolation-acceptance-run1-20261124T233915Z.json), kept unchanged |
| 2 | not run | probe v3 + host-side evaluators (`isolation/acceptance-rules.mjs`) | — | waits for the owner's pin refresh and a rebuilt golden image |

### Why none of run 1's 11 `PASS` rows count

Run 1 ran on the real VM, but its verdicts were decided by v1 code that this remediation found unsound:

* **Vacuous outcomes.** "Could not connect" was any `OSError` class name, so an unrecognised error counted as a PASS. Empty maps and a probe section that threw also passed. Scenario 11 passed when the probe had not run at all (`undefined !== 0`).
* **Scenario 9 CPU.** The 40 % Job Object cap could never bind on a 2-vCPU VM with 20 logical CPUs (the VM can use at most 10 %), so the cap was recorded but never shown enforced.
* **Scenario 13.** Nothing checked that the planted residue existed before the overlay was discarded.

## Run 1 failures and their remediation

| # | Run 1 observation | Root cause | Remediation (privileged, awaiting re-pin) |
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
  * `dh3 doctor` counts a PASS only if it came from the current probe version, golden image and closure digest. Otherwise it reports `STALE`.
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

* Scenario 6 records whether a WSL distribution or Docker Desktop was actually running. If none was, an active neighbour network was not exercised.
* Scenario 12 proves host-side artifact integrity, not binding to the D3.2 evaluator (that needs the D3.4 issuer keys).
* Scenario 10 does not cross-check the QEMU argv read from `qemu-cmdline.txt` against the live process command line. No host canary listeners back up scenarios 3 and 4.
* On another host, Defender could quarantine the unsigned PE fixture. That would be a false scenario 2 FAIL, not a security problem.
* Run 1 left a test `.claude.json` (`oauthAccount` = the worker's `id` string) on the persistent auth disk. The sanitizer keeps that key, and a real login overwrites it.
* AI-run automated test, not an external audit. QEMU still runs as the owner (O-7).

## To complete acceptance (owner-scheduled)

1. The owner reviews the diff and refreshes the pins (`bypass-pins.mjs --scope dh3-d33 --print`, then `--write`).
2. Rebuild the golden image, since the guest hardening is applied at provisioning: `node scripts/developer-harness-v3/bin/dh3.mjs provision --wait-minutes 60`. Before sealing, provisioning must confirm the hardening is in effect.
3. `node scripts/developer-harness-v3/bin/dh3.mjs verify-isolation`. Results land in `%LOCALAPPDATA%\PatelRep\dh3\evidence\runs\`.
4. Re-render this document from that run. Copy the run file into `evidence/` unchanged.
