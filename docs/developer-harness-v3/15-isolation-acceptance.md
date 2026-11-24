# Developer Harness V3 — 15 Isolation Acceptance (D3.3)

## Verdict: `ISOLATION_UNPROVEN` — the 13-scenario real-VM suite has NOT completed

The suite (`dh3 verify-isolation` → `isolation/acceptance.mjs` + `isolation/guest-probe.py`) is implemented and runs against the real VM, but it
requires a provisioned golden image. Provisioning on this laptop was attempted repeatedly. Each attempt surfaced a real defect, which was fixed
(17 §2.2). The final attempt, with all fixes applied, was **stopped by Claude Code's low-memory reaper** while it was pushing the Claude package into
the guest. The host had ~2.9 GB free because of the owner's normal workload plus the 1.3 GB VM. Per that notice, the run was not restarted
automatically. **No scenario below has a real-VM PASS.** Unit and synthetic tests are not counted as proof.

| # | Scenario (05 §5) | Real-VM verdict | What exists |
|---|---|---|---|
| 1 | Windows paths / host credentials | **NOT RUN** | probe implemented (mount types, WSL paths, block devices) |
| 2 | Windows executable interop | **NOT RUN** | probe: binfmt, Windows tools, PE exec attempt |
| 3 | host loopback & LAN services | **NOT RUN** | probe: slirp gateway + host LAN address × :22/135/445/3000/5432/5433/8000/8080, slirp DNS |
| 4 | controller surfaces | **NOT RUN** | probe: SSH hostfwd + proxy ports from the guest network, IP-literal/localhost CONNECTs (no QMP exists) |
| 5 | internet + DNS | **NOT RUN** | probe: resolver, public DNS, direct TCP, proxy deny list, positive control `api.anthropic.com` |
| 6 | other VMs / WSL / Docker | **NOT RUN** | probe: WSL/Docker/neighbour addresses |
| 7 | container sockets / privilege | **NOT RUN** | probe: sockets, tools, `sudo -n` |
| 8 | bounded disk | **NOT RUN** | home-disk fill (ENOSPC required) + virtual-size checks |
| 9 | bounded RAM / CPU | **NOT RUN** | guest over-allocation (OOM-kill or `MemoryError` required) + host sampling during a CPU burn |
| 10 | host integration channels | **NOT RUN** | probe: virtio ports, USB, vsock, agents + host argv allow-list |
| 11 | clock / policy / evidence state | **NOT RUN** | guest clock shift vs host clock; worker `date -s` refused |
| 12 | artifact integrity | **NOT RUN** | hardened bundle import + genuine/forged/`gitdir:` claims |
| 13 | snapshot recovery / residue | **NOT RUN** | overlay discard + sanitizer attack (symlinks, FIFO, hard link) |

## Real-VM observations that DID happen (2026-11-24, TCG, 768–1 280 MB)

These are observations, not acceptance results.

* QEMU 11.1.3 started under the Job Object supervisor at **BelowNormal** priority. Guest SSH came up after 224–282 s, and cloud-init completed (seed read, home disk partitioned and formatted).
* In the guest, `sshd -T` showed the hardened config (`allowusers ctl`, `allowtcpforwarding remote`, `permitlisten 127.0.0.1:3128`, `permitopen none`, `gatewayports no`).
* The guest showed only `127.0.0.1:3128` (the controller's remote forward), `:22`, and its own local resolver listeners.
* The SSH client log showed the remote forward connecting only to the configured host proxy port.
* Killing the identity-verified supervisor terminated QEMU through the Job Object, twice. Once it was immediate. Once it took more than 3 s, still within the controller's 15 s verification window.
* The Resource Governor's **waiting_resources** decisions were observed live, many times: it waited ~2–15 min until available memory exceeded the probe threshold, then admitted.
* Defects found only by the real run: the in-process proxy was frozen by synchronous controller SSH calls; the Debian 13 `mirror+file` apt lists used HTTP; IPv6-first dialling broke tunnels; QEMU 11 flag changes; PowerShell `DETACHED_PROCESS`; QEMU's Windows pipe chardev blocks start; a missing `SYSTEMDRIVE`. All are fixed (17 §2.2).

## To complete acceptance (owner-scheduled)

1. Free memory first (≥ 3.4 GB available for the probe VM; the governor checks this itself), or run while the laptop is otherwise idle.
2. `node scripts/developer-harness-v3/bin/dh3.mjs provision --wait-minutes 60`, then `node scripts/developer-harness-v3/bin/dh3.mjs verify-isolation`.
3. Re-render this document from `%LOCALAPPDATA%\PatelRep\dh3\evidence\isolation-acceptance.json`.
4. Repeat under **WHPX** after O-1. The TCG run does not exercise hypervisor-grade containment.
