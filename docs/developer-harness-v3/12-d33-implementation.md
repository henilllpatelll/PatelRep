# Developer Harness V3 — 12 D3.3 Implementation: Local Infrastructure, Isolation, Resource and Subscription Governors

**Status: implemented and tested; V3 remains INACTIVE** (`authority-contract.json activation.active_actions = []`, unchanged). D3.3 adds runtime
components under `scripts/developer-harness-v3/{runtime,infra,isolation,bin}` and documents 12–17. It does **not** modify the D3.2 contract,
evaluator, lifecycle contract, any V2 file, workflow, ruleset, secret, migration or `.claude/settings*.json`.

## 1. Selected isolation runtime

**QEMU 11.1.3 (free, GPL) as a dedicated Linux VM**, installed user-scope from the official MSYS2 repository (installer GPG-verified against the
fingerprint published on msys2.org; packages pacman-signature-checked). Debian 13 genericcloud guest (sha512 pinned).

| Option | Verdict on this laptop | Reason |
|---|---|---|
| **QEMU (WHPX accelerator, TCG until O-1)** | **selected** | no kernel driver, no service, no network adapter, no admin to install; works beside running Hyper-V/VBS/HVCI and WSL; user-mode networking with `restrict=on` gives an externally enforced default-deny network *without any host network change*; qcow2 backing chains give clean per-task snapshots |
| VirtualBox 7 | rejected | installs kernel drivers and a host-only/bridged network filter (host-wide changes, admin); on a host where Hyper-V is active it runs through the same WHP API anyway (slower, historically unstable); larger guest→host device surface (shared folders, clipboard, drag-drop services exist and must be disabled) |
| Hyper-V Manager / Windows Sandbox | unavailable | Windows 11 **Home** |
| Hardened WSL2 | rejected | same utility VM and kernel as the owner's `Ubuntu` and `docker-desktop` distros; `wsl.conf` automount/interop switches are writable by root inside the distro |
| Docker Desktop container | rejected | shares the Docker Desktop VM; the socket is the boundary |

Hardware acceleration: Windows Hypervisor Platform is **disabled** on this host; enabling it is owner action **O-1** (admin + reboot; does not
disable VBS, HVCI or WSL). Until then the VM runs under **TCG** (software emulation): functional but slow (boot ≈ 4 min), and **not a security
boundary by QEMU upstream's own policy** — TCG results prove the configuration (network, mounts, channels, residue), not hypervisor-grade containment.

## 2. Components

| Component | File | Implemented | Tests |
|---|---|---|---|
| Setup (idempotent, dry-run, manifest rollback) | `infra/setup.mjs`, `infra/artifacts.json`, `infra/layout.mjs` | yes — **run on this host** | `d33-infra` |
| Guest configuration (cloud-init, sshd, managed settings, residue sanitizer, provisioning script) | `infra/cloud-init.mjs` | yes | `d33-infra` |
| Seed ISO (IMAPI2, no admin) / Job Object supervisor | `infra/seed-iso.ps1`, `infra/job-supervisor.ps1` | yes — run on this host | real VM run |
| Provisioning / task worker / reset | `infra/provision.mjs` | yes | real VM run (15) |
| QEMU command line + invariant validator | `runtime/qemu-args.mjs` | yes | `d33-infra` |
| VM controller (keys, SSH, egress channel, QMP, verified stop, liveness) | `runtime/vm-controller.mjs` | yes | real VM run (15) |
| Egress policy + CONNECT proxy | `runtime/egress-policy.mjs`, `runtime/egress-proxy.mjs` | yes | `d33-egress` + scenario 5 |
| Host/guest sampler | `runtime/host-sampler.mjs` | yes — run on this host | `d33-resource` |
| Resource Governor | `runtime/resource-governor.mjs` (uses D3.2 `admitTask`) | yes | `d33-resource` + real admission waits |
| Subscription Governor | `runtime/subscription-governor.mjs` | yes | `d33-subscription` (recorded-shape + synthetic) |
| Stream telemetry (D3.4 interface) | `runtime/session-telemetry.mjs` | yes | `d33-subscription` |
| Trusted launcher | `runtime/launcher.mjs` (uses D3.2 `evaluate`) | yes; **dry-run only**, no real worker session run | `d33-launcher` |
| Worker lifecycle / recovery primitives | `runtime/worker-lifecycle.mjs`, `lib/atomic.mjs` | yes | `d33-lifecycle` |
| Adversarial acceptance suite | `isolation/acceptance.mjs`, `isolation/guest-probe.py` | yes | real VM run (15) |
| Subscription probe | `isolation/subscription-probe.mjs` | yes; **not run** (needs owner login, O-2/O-3) | — |
| Operator CLI | `bin/dh3.mjs` | yes | doctor/monitor/provision run on this host |

## 3. Design-only / not implemented in D3.3

Persistent task orchestration and the durable ledger (D3.4) · automatic 70 % context renewal (D3.4; telemetry interfaces delivered, 14 §4) · issuer
services and signing keys (no evidence can authenticate yet, so `isolation_attestation` cannot be issued and `start_bypass_permissions_session`
cannot be allowed) · model routing · PR publishing, merge, staging, production · Telegram/dashboard · running QEMU under a dedicated Windows account
(O-7) · outbound firewall rule for QEMU (O-6) · V3 tests in CI (protected control-plane change, unchanged prerequisite).

## 4. How the pieces fit (one task, as D3.4 will drive it)

`admit('vm_start')` → `startTaskWorker` (fresh overlay on read-only golden, Job Object caps) → egress proxy (`runtime` profile) + SSH remote forward →
launcher: binary/settings preflight, `buildWorkerEnvironment`, `normalizeAuthStatus` + governor extra-usage fact → `buildTrustedLaunch` → D3.2
`evaluate` → `buildInvocation` → `runSession` (lock, kill switches, telemetry) → `classifyObservation` → `nextGovernorState` → lifecycle event
(D3.2 reducer) → stop VM / discard overlay → `cleanupPlan` (D3.2 `resource_ownership`).
