# Developer Harness V3 — 03 Threat Model and Trust Boundaries

Scope: the autonomous developer harness on the owner's Windows 11 Home laptop plus the existing GitHub/Railway/Vercel/Supabase delivery path.
Customer-facing agents (H1–H7) are a different system and are out of scope except that developer identities hold no authority over them.

## 1. Zones

| Zone | Contains | Trusted? |
|---|---|---|
| **Z0 Owner** | the human; ChatGPT planning; the owner root-of-trust ceremony | root of trust |
| **Z1 Windows host** | the owner's daily environment, personal files, browser sessions, WSL distros, existing credentials | **never exposed to candidate code** |
| **Z2 Controller** (D3.3/D3.4) | task DB, queue, scheduler, evaluator, evidence ledger, notification outbox, pinned policy | trusted; must not be reachable from Z3 |
| **Z3 Isolated worker** | the VM in which `claude --dangerously-skip-permissions` runs and the candidate's code executes | **untrusted** (assumed compromised by prompt injection) |
| **Z4 Trusted verifiers/issuers** | reviewer sessions, test runner on a pristine checkout, delivery verifier, publisher | trusted code, separate keys; never run candidate-controlled code outside Z3 |
| **Z5 GitHub / providers** | rulesets, CI Gate, Staging Gate, environments, Railway/Vercel/Supabase | **authoritative** for what they guard |

Information flows toward Z2 only as **data** (a branch/bundle pulled by Z4, artifacts, event messages). Nothing in Z3 can invoke Z2 or Z4.

## 2. Assets

Owner's Claude login (the only AI credential) · GitHub App private key and publisher tokens · Supabase service role and production DB URL ·
Railway/Vercel/EAS tokens · repository integrity (history, migrations) · customer data and tenant isolation · the policy and key registry ·
subscription allowance · owner's attention (false alarms count).

## 3. Threats and mitigations

| ID | Threat | D3.2 mitigation (implemented, tested) | Needs runtime (D3.3+) |
|---|---|---|---|
| V3-T1 | Prompt injection via repo text, logs, issues, Telegram, web content | no input channel confers authority; identity/scope/policy come from the trusted part only; unknown request fields rejected | worker sees untrusted data only inside Z3 |
| V3-T2 | Implementer self-approves or mints evidence | implementer has no key and no evidence type; claims ≠ identity are denied; reviews need distinct contexts | separate review sessions with their own keys |
| V3-T3 | Candidate edits the policy/evaluator/hooks to weaken verification and benefits at once | those paths are root-of-trust: automation is **denied**; verification always runs under the **pinned active** policy; successor judged by the active one | verifier runs from a pinned trusted checkout (§4) |
| V3-T4 | Candidate selects its own policy revision | revision is a content hash; pin supplied out-of-band; `loadPolicy` refuses mismatches; evaluator refuses objects not produced by `loadPolicy`; claimed revision denied | pin stored outside Z3 (§4) |
| V3-T5 | Forged, stale, replayed, mis-bound or wrong-issuer evidence | Ed25519 verification, issuer/key/identity cross-check, TTL, binding to SHA/tree/base/repo/env/policy/task/fencing, nonce conflict, single-use ledger | durable ledger; issuer services |
| V3-T6 | Migration relabeling (reproduced R-06) | classification from Git facts only; case/alias/rename-as-delete handling | facts gathered in Z4 clone |
| V3-T7 | Paid-API authentication selected accidentally | forbidden env/settings, positive subscription-source verification, `$0` limit, purchases prohibited | launcher performs the verification in Z2 |
| V3-T8 | Credential exposure to the candidate | worker environment is an ALLOW-LIST (unknown names refused; credential-shaped names flagged); `settings.env` counted; scoped credentials with per-scope evidence | worker image has no secrets except the Claude login (T9) |
| V3-T9 | Claude login exfiltrated from Z3 (Anthropic documents this limit of containers) | **not solvable in code** | egress allow-list outside Z3, short-lived exposure, owner can revoke the login |
| V3-T10 | Worker escapes isolation to the host | D3.2 only **requires** proven isolation properties before bypass mode | VM boundary, no shared folders/interop/sockets, adversarial tests (05) |
| V3-T11 | Customer-agent activation/billing via a developer task | prohibited actions; declared-effect denial; heuristic tripwire; security review for agent paths | schema contracts + reviewed preview remain authoritative |
| V3-T12 | Memory/disk exhaustion kills work | admission control; pressure is a recoverable state | sampler, enforcement, calibration |
| V3-T13 | Runaway subscription use | one reasoning session; sequential reviews; waiting state on limit | usage detection; shared allowance with GitHub workflows (N-2) |
| V3-T14 | Hostile local Git config (external diff, textconv, hooks, `GIT_DIR`, color, `ignoreSubmodules`, `binary` attributes, spoofed origin) during fact gathering | `GIT_*` stripped; global config blanked; diff driver, hooks, fsmonitor, color, submodule-ignore, textconv neutralized; `--text` for tripwire input; literal pathspecs; anchored origin match; each tested | verifier clone owned by Z2 (a bare clone the verifier fetched itself is better still) |
| V3-T15 | Evidence/task state deleted or rewritten | `delete_task_evidence` prohibited; fencing and revision checks in the reducer | append-only DB |

## 4. The policy trust boundary (summary; full protocol in 04)

The deployed boundary is produced by **external controls**, not by this repository's code. A library, a checksum, a hook or a Git worktree alone
does not establish it. Required controls:

1. **Pin outside the worker.** The active policy revision and trusted key registry live where Z3 has no read-write access (controller database or a
   root-owned file on the controller side), changed only by the promotion protocol or the owner ceremony.
2. **Verifier from a trusted checkout.** The evaluator, evidence verifier and fact gatherer run from a checkout of a *merged, pinned* revision, never from the candidate's tree.
3. **Issuer keys never enter Z3.** Private keys for reviewers, verifier, publisher and promoter live in their own processes/identities in Z2/Z4.
4. **One-way data flow.** Z3→Z4 by pulling a bundle; no inbound path from Z3 to Z2.
5. **OS controls:** separate OS accounts or VMs per zone, filesystem permissions, no shared folders, firewall egress allow-list, no host sockets.
6. **Repository controls:** the existing `main` ruleset, CI Gate/Staging Gate and environments remain the final backstop.

## 5. Root-of-trust changes that cannot authorize themselves

Trusted key registry, identity registry, evidence issuers, root-of-trust path list, financial authority, credential scopes, activation list, the
evaluator and verifier code, and `.claude/settings.json`/hooks. Changing any of these is an **owner ceremony** performed outside the harness
(04 §5). The D3.2 PR itself adds root-of-trust files; **its merge and any later activation are owner decisions**, not harness decisions.

## 5a. D3.3 runtime boundary (what now exists, and what it does not cover)

"Evidence" below names where the property is tested; the real-VM verdict for each scenario is in 15 (scenarios marked NOT RUN there are **not** proven).

| Boundary | Mechanism (implemented in D3.3) | Evidence | Not covered |
|---|---|---|---|
| Z1 ↔ Z3 filesystem / interop | dedicated QEMU VM, own kernel; `-nodefaults`; no shared folder, `fat:`/9p/virtfs drive, USB, audio, display, serial, guest agent, virtio-serial or **monitor/QMP** channel; `validateQemuArgs` is an exact allow-list re-checked at every launch | 15 scenarios 1, 2, 7, 10; `d33-infra` | a QEMU device-model, TCG or WHPX escape. **QEMU upstream does not treat TCG as a security boundary**, and QEMU runs as the owner's Windows user (Job Object: 1 process, memory/CPU caps, UI restrictions — not a privilege drop). O-1 (WHPX) + O-7 (dedicated account) are activation gates |
| Z3 network | slirp `restrict=on` (no packet from the guest is routed anywhere), IPv6 off, no guestfwd; ONE hostfwd on host loopback for the controller's SSH | 15 scenarios 3, 4, 5, 6 | a libslirp vulnerability (mitigation O-6 firewall rule, owner-only); the loopback SSH port is reachable from other host-local software (Docker containers, WSL) — it only leads to the guest's sshd (key auth) |
| Z3 egress | only via guest-loopback :3128 carried by the **controller-initiated** SSH remote forward to a host-loopback CONNECT proxy: exact host allow-list per profile, 443 only, IP literals refused in every form, host-side resolution with public-unicast check and dial-by-vetted-address (no rebinding), **TLS SNI must equal the CONNECT host** (no domain fronting), byte/idle/tunnel budgets, no TLS interception, profile switch closes tunnels | 15 scenario 5; `d33-egress` | **same-destination exfiltration** (V3-T16, below) |
| Z3 → Z2 | the guest cannot open any connection; the controller only *pulls* (SSH exec; bundles imported by verify + fsck fetch into a fresh bare repo, never `clone`) and treats output as data; SSH client has no agent/X11/local forwards/ControlMaster and a host-generated pinned host key; login output is escape-stripped | 15 scenarios 3, 4, 11, 12; `d33-infra` | the SSH client parsing hostile server output (OpenSSH client CVEs) |
| Resources | Job Object hard caps on QEMU (committed memory, CPU rate, one process) + kill-on-close (observed: killing the supervisor terminated QEMU); below-normal priority; fixed virtual disks; Resource Governor admission with hysteresis, reservations, unowned-load accounting | 15 scenarios 8, 9; `d33-resource` | a host already short of memory because of the owner's own load (the governor waits; it cannot make memory) |
| Task residue | per-task qcow2 overlay on a read-only golden image; persistent 512 MB home disk reduced at every boot by a root, fd-relative, `O_NOFOLLOW` sanitizer to the two Claude login files (credentials shape-checked); sshd **requires** its success | 15 scenario 13 (includes a planted-symlink attack) | the kept JSON values are a small covert channel between tasks; the login itself persists by design |
| Launcher authority | environment built from an allow-list (never inherited); exact-name origins; pinned root-owned binary (pin computed on the host); `--setting-sources ""` + `--strict-mcp-config` + root-owned managed settings incl. `disableBypassPermissionsMode: "disable"` until activation; the launcher calls the D3.2 evaluator itself; init-event verification and overage kill switch; single-session lock released only after verified remote termination | `d33-launcher` | effect of `--setting-sources ""` inside the VM is NOT VERIFIED until the owner logs in (14 §5); facts relayed from the guest (auth status, stream events) can be forged by a compromised same-uid worker — they are defence in depth, never proof |

New threats recorded in D3.3:
* **V3-T16 same-destination exfiltration.** Allow-listed provider hosts accept uploads. Anything the worker can read, including its own Claude OAuth refresh token, can be sent there. An attacker-supplied API key (e.g. Message Batches) can carry data into the attacker's own Anthropic account, and a stolen refresh token works from anywhere against the owner's subscription. Not solvable by egress filtering. Mitigations: short exposure, owner can revoke the login, credential-shaped data scans in Z4 (D3.6).
* **V3-T17** QEMU runs as the owner (above).
* **V3-T18** provider-terms risk for unattended subscription use (Consumer Terms §3, 14 §2; owner decision O-4).
* **V3-T19** the extra-usage fact is only observable inside a request and is relayed by the guest. It is mitigated, not eliminated, by the one-shot owner-attested probe and a per-session kill switch. The real control is usage credits OFF in the owner's account.
* **V3-T20** the worker can start additional `claude` processes (quota use outside the session lock) until the controller kills the guest `worker` processes at session end.

## 6. Residual risks (honest list)

R1 Claude login resident in Z3. R2 Same-user local trust until D3.3 isolation exists. R3 Windows Home has no Hyper-V manager, Windows Sandbox or
Defender Application Guard, so isolation relies on a third-party free VM runtime or on WSL2 hardening. R4 Provider-side limits (`staging` unprotected,
`production` secrets without required reviewers) are unchanged. R5 `PRODUCTION_AUTO_*` is `true`: V3 inherits a live production path. R6 Heuristic
customer-agent tripwire can miss novel phrasing; it is defense in depth only. R7 Plan limits assume "ordinary individual usage" (N-5).
