# Developer Harness V3 — 05 Local-First Execution Architecture (design)

**Design only. D3.2 installs, provisions and reconfigures nothing on the host.** Everything marked *requires D3.3* is unproven. Measurements cited are
the read-only host facts in 01 §4.

## 1. Constraints that shape the design

Windows 11 Home x64 · i7-13700H · 16 GB (≈3.9 GB free at measurement) · ≈416 GB disk · laptop kept powered · owner keeps using it · Claude Max 5x (owner-reported; upgraded from Pro),
paid usage off · zero new hosting cost · hypervisor already running (VBS on); WSL2 with the owner's `Ubuntu` + `docker-desktop` distros and Docker
Desktop installed; `.wslconfig` already caps WSL at 6 GB/4 GB swap; VirtualBox, QEMU and Podman **not** installed.

Windows 11 Home lacks the Hyper-V Manager role, Windows Sandbox and Application Guard (known edition limits, not re-measured here), so the free
isolation candidates are: a dedicated Linux VM under a free third-party runtime (VirtualBox, or QEMU with the Windows Hypervisor Platform
accelerator), hardened WSL2, or rootless containers inside either.

## 2. Components

| Component | Choice | Why |
|---|---|---|
| Controller | one Node.js process (no framework) | the repo is already Node/TS; deterministic; small |
| Task store | SQLite (WAL, `synchronous=FULL`), one file owned by the controller account | transactional queue and append-only event log without a server; a durable outbox lives in the same DB |
| Queue | `jobs` table with leases, fencing tokens, idempotency keys | exactly the reducer invariants in `lifecycle.mjs` |
| Worker | Linux VM (Z3) running `claude --dangerously-skip-permissions` as a non-root user | the only place Bypass Permissions may run |
| Verifiers/issuers | separate processes, separate keys, pristine checkouts (Z4) | evidence must not be producible from Z3 |
| Delivery | existing GitHub CI Gate, Staging Gate, trusted publisher, Release Engineer | reuse; do not compete |
| Remote | Telegram long-polling (outbound only) + local dashboard on loopback | no inbound exposure |

Not chosen: a paid hosted control plane (rejected by the owner); an always-on cloud agent; an API-key based agent runtime.

## 3. Isolation options evaluated

| Dimension | Plain WSL2 distro | Hardened WSL2 distro | Docker Desktop container | Dedicated Linux VM (VirtualBox or QEMU/WHPX) | Rootless containers *inside* the VM |
|---|---|---|---|---|---|
| Kernel/boundary vs host | shared lightweight VM with the owner's distros; Windows user context | same | same VM as WSL2 | **own kernel, own virtual hardware** | adds user-namespace layer only |
| Windows drive access | `/mnt/c` mounted read/write by default (reaches `~/.claude`, `.env`, SSH) | can be disabled by `/etc/wsl.conf` `[automount] enabled=false`, but that file is writable by root *inside* the distro | bind mounts of host paths | **none unless a shared folder is configured; none will be** | n/a |
| Windows interop (run `cmd.exe`/`powershell.exe`) | **on by default** (host code execution as the owner) | `[interop] enabled=false`, same self-edit caveat | via Docker CLI/socket | **absent** | n/a |
| Host network | NAT/mirrored; host services reachable | Hyper-V firewall may restrict (**not verified**) | host-internal network | host-only adapter + **proxy allow-list outside the VM** | n/a |
| Other distros / docker-desktop distro | co-resident in the same VM | co-resident | is one | **separate** | n/a |
| Docker socket | exposed if Docker Desktop integration is on | can be off | **is** the socket | not installed | rootless socket stays in the VM |
| Resource limits | `.wslconfig` caps the *whole* WSL VM, not per-distro | same | same | **per-VM fixed RAM/CPU/disk** | cgroups inside |
| Escape risk | high: root in distro + interop/automount toggles | medium; depends on proving a hostile root cannot undo it | high | **lowest of the free options** (hypervisor boundary) | reduces blast radius inside the VM |
| Memory overhead | shares the existing 6 GB WSL cap | same | same | additional VM RAM (proposed ≈6 GB, **would add to** an active WSL VM) | small |
| Artifact transfer | shared filesystem (unsafe) | same | volumes | **pull a git bundle/branch from the VM; verify the tree digest** | n/a |

**Recommendation (to be proven in D3.3):** a **dedicated Linux VM** with *no* shared folders, clipboard, USB or serial, a **host-only network**, and all
outbound traffic forced through a **host-side allow-listing forward proxy** (DNS also via the proxy). Run Claude as a non-root user in the VM. Rootless
containers inside the VM are optional extra containment for test workloads, not the boundary. Hardened WSL2 is a fallback **only if it passes the
same adversarial suite (§5)**; plain WSL2 and Docker Desktop are rejected for Bypass Permissions. The owner's `Ubuntu` and `docker-desktop` distros
must never be reused as workers.

**If no option passes §5 on this hardware with free tools, D3.3 records the genuine blocker `ISOLATION_UNPROVEN`, V3 execution stays disabled, and
Bypass Permissions is not enabled anywhere.** Weakening the test to make an option pass is forbidden.

Memory reality check: the proposed ≈6 GB VM plus the existing 6 GB WSL cap plus the owner's own workload do not fit in 16 GB at once. The Resource Governor
must treat the owner's WSL/Docker Desktop memory as **unowned, uncontrollable load**: it may never shut it down, so admission must be conservative or
require the owner to stop Docker Desktop (an owner-only setup item).

## 4. Network and credential design

- The VM has **one** adapter: host-only. No default route. A controller-owned CONNECT proxy on the host-only address allow-lists exactly the
  hostnames measured as required (Claude API/login endpoints, GitHub, the npm/PyPI registries actually used, Supabase staging only if a task needs it).
  **The allow-list is measured in D3.3; this document does not assert it.**
- The only credential in the VM is the owner's native Claude login, entered interactively *inside the VM* once. It is never exported, proxied,
  scraped or copied (`CLAUDE_CODE_OAUTH_TOKEN`-style export is a forbidden worker variable). Because Anthropic documents that containers do not stop
  exfiltration of that login, egress control is a hard requirement and the owner can revoke the login at any time.
- No GitHub, Supabase, Railway, Vercel, Expo or Stripe credential enters the VM. The VM pushes nothing: Z4 **pulls** the branch, gathers Git facts,
  and the trusted publisher pushes.
- The controller API and the proxy bind to specific interfaces; the control API is loopback-only and unreachable from the host-only network.

## 5. Adversarial isolation acceptance suite (D3.3 must pass all; none runs in D3.2)

| # | From inside the worker, attempt to… | Required result |
|---|---|---|
| 1 | read any Windows path or `~/.claude`, `.env`, `~/.ssh` of the host | impossible (no mount, no path) |
| 2 | execute a Windows binary (`cmd.exe`, `powershell.exe`) | impossible |
| 3 | connect to host loopback services (e.g. :3000, :8000) and the host gateway | refused |
| 4 | reach the controller API/SQLite/proxy admin | refused |
| 5 | connect to a non-allow-listed host or IP, resolve an arbitrary DNS name | refused |
| 6 | reach another VM, WSL distro or the Docker Desktop VM | refused |
| 7 | find a Docker/containerd socket, run a privileged container | none present |
| 8 | read or write the VM disk image from outside its limits; fill the disk | bounded by the virtual disk |
| 9 | exhaust RAM/CPU (bounded allocation, fork pressure) | VM is throttled or killed; host stays responsive; the **live host is not used for this test unattended** |
| 10 | use clipboard, drag-drop, USB, serial, shared folders, guest additions channels | disabled |
| 11 | tamper with the clock or the evidence ledger/pin | no write path |
| 12 | send a modified tree back | Z4 pulls a bundle and recomputes `tree_digest`; mismatch is a denial |
| 13 | restore a snapshot | clean state; no residue across tasks |

## 6. Startup, sleep, network and power recovery (design)

- The controller runs as a **service under a dedicated low-privilege local account** (the host already runs another NSSM service, so the pattern
  exists), set to restart on failure. The VM is started and stopped only by the controller.
- **Reboot / power loss:** on start the controller replays SQLite; every task that was `running` becomes `worker_recovery` with a fresh lease and a
  higher fencing token; uncommitted work is recovered from the worktree snapshot taken at each checkpoint; committed work from the branch.
- **Sleep/hibernate:** treat a wall-clock jump as an incident: all leases are re-validated, evidence TTLs are re-checked, running sessions become
  `worker_recovery`. The owner sets the power plan to never sleep on AC (owner-only setup item).
- **Network loss:** `waiting_external` with bounded exponential backoff; deterministic work continues; no AI call is retried in a tight loop.
- **Claude auth expiry** is the one subscription-related item that is a *genuine blocker* (`OWNER_AUTH_EXPIRED`); quota exhaustion is not (07).

## 7. Remote management

- **Telegram:** outbound long-polling only (no webhook, no inbound port). One allow-listed numeric owner ID. A message is *data* until it passes
  sender authentication, then becomes `task_ingress` input; scope-widening or anything touching the root of trust requires a second confirmation. Notifications go
  through the durable outbox: completion, genuine blockers, unresolved critical production incidents only.
- **Dashboard:** static page served on `127.0.0.1` with a per-run token, no CORS, no tunnel, no public bind. Read-mostly; mutations need the same ingress checks.
- Neither interface can reach Z3 and neither can mint evidence.

## 8. What D3.2 verified vs. did not

Verified: host facts (01 §4); the platform limits that drive the choice come from Microsoft/Anthropic behavior stated above and are **not**
re-measured. Not verified: that VirtualBox or QEMU/WHPX run acceptably next to the existing WSL VM on this laptop; Hyper-V firewall behavior for WSL on Home;
the proxy allow-list; any performance or memory number.
