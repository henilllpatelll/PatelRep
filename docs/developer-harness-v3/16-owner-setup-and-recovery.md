# Developer Harness V3 — 16 Owner Setup, Operation and Recovery Guide (D3.3)

**V3 is inactive.** Nothing below starts autonomous work, and nothing enables Bypass Permissions. All commands run from a PatelRep checkout:

```
node scripts/developer-harness-v3/bin/dh3.mjs <command>
```

Everything D3.3 installs lives in **one folder**: `%LOCALAPPDATA%\PatelRep\dh3` (QEMU, images, the worker VM, controller state, evidence).
No administrator rights, driver, service, network adapter, PATH change or host-wide setting is created by the scripts. Your WSL distros, Docker
Desktop, `.wslconfig`, pagefile, Hyper-V/VBS/Memory Integrity, Defender and firewall are never touched.

## 1. Everyday commands

| You want to… | Command | What happens |
|---|---|---|
| Check everything | `doctor` | one line per check with a reason code and, where needed, the exact fix |
| Install / repair the free VM runtime | `setup` (`--dry-run` to preview) | user-scope QEMU (official MSYS2 package, GPG/pacman-signature verified), Debian 13 image (sha512 pinned), Claude Linux binary (npm integrity pinned) |
| Build the worker image (once) | `provision --wait-minutes 45` | waits for memory headroom, boots once with cloud-init, installs git/ripgrep and the pinned Claude, makes the golden image read-only |
| Start / stop the worker | `start` · `stop` | start waits for memory headroom automatically; stop is graceful → forced → verified |
| Wipe the task disk | `reset` | discards the task overlay; golden image and your login are kept |
| See health | `status` · `monitor --samples 20 --interval 15` | VM liveness from host facts; host memory/commit/paging/CPU/disk and the admission decision |
| Prove isolation | `verify-isolation` | runs the 13-scenario adversarial suite against the real VM, writes `evidence\isolation-acceptance.json` |
| Remove all D3.3 infrastructure | `remove --dry-run`, then `remove` | stops the VM, deletes only the paths recorded in the setup manifest (all inside the one folder) |

The governor **waits instead of asking you** when memory is short. If it keeps waiting while you work, that is expected on this 16 GB laptop: the
worker needs about **5.5 GB available** (3 GB VM + 0.5 GB QEMU + 2 GB left for you). You never have to free memory; if you *want* it to start sooner,
closing large apps (browser tabs, Docker Desktop) is your choice.

## 2. Owner-only one-time actions (the harness never does these)

| # | Action | Why | Exactly how |
|---|---|---|---|
| O-1 | **Enable Windows Hypervisor Platform** (admin + reboot) | lets QEMU use the hardware hypervisor (WHPX) instead of slow software emulation (TCG). It does **not** disable VBS, Memory Integrity or WSL — they keep running. | Start → "Turn Windows features on or off" → tick **Windows Hypervisor Platform** → OK → reboot. Or elevated PowerShell: `Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform` then reboot. Afterwards `doctor` shows `RUNTIME.WHPX ok`; re-run `provision` and `verify-isolation` (the isolation evidence is accelerator-specific). |
| O-2 | **Log in to Claude inside the worker** | the only credential the worker ever holds | `start`, then `login` (it first resets the worker to a fresh task disk); open the printed URL in your browser, approve, paste the code back. The harness relays your terminal to the VM and never reads the bytes. Then `auth-check` must show `verified: true, plan: claude_max_5x`. |
| O-3 | **Attest that usage credits (extra usage) are OFF** | the CLI exposes the provider's overage status only inside a request; one minimal probe is needed to read it | confirm in claude.ai → Settings → Usage that usage credits are off, then `attest-extra-usage-off`, then `probe-subscription` (one Haiku request, no tools). `doctor` → `SUBSCRIPTION.EXTRA_USAGE_VERIFIED_OFF ok` only if the CLI stream (relayed from the VM) reports overage disabled, and only for 6 h. The attestation is one-shot and expires after 24 h. This is a corroborating check; the binding control is your account setting. |
| O-4 | Decide the **Consumer Terms** question (see 17 §4) | Anthropic's terms restrict automated access with a subscription except where explicitly permitted | owner decision; V3 stays inactive until it is made |
| O-5 | Keep "sleep when plugged in" = **Never** (already measured: Never) | a sleeping host stops the worker | Settings → System → Power |
| O-6 (recommended before activation) | Outbound firewall rule for QEMU (admin) | defence in depth if QEMU's user-mode network were ever bypassed | elevated PowerShell: `New-NetFirewallRule -DisplayName "DH3 QEMU loopback only" -Direction Outbound -Program "$env:LOCALAPPDATA\PatelRep\dh3\runtime\msys64\ucrt64\bin\qemu-system-x86_64.exe" -RemoteAddress Internet,Intranet -Action Block` |
| O-7 (recommended before activation) | Run QEMU as a dedicated low-privilege Windows account (admin to create) | a QEMU escape would otherwise run as you | design in 17 §3; not implemented in D3.3 |

## 3. Recovery

| Symptom (`doctor` / `status` code) | Meaning | What to do |
|---|---|---|
| `RESOURCE.*_HEADROOM_INSUFFICIENT`, `waiting_resources` | not enough free memory now | nothing; it resumes by itself. Optional: close apps |
| `RESOURCE.MEMORY_CRITICAL` | host < 1 GB available | new work stops; running VM keeps its fixed RAM. If the desktop is sluggish: `stop` |
| `VM.ALREADY_RUNNING_OR_UNKNOWN` | a VM record exists and liveness could not be disproved | `status`; if both pids are gone, `stop` clears it |
| `RECOVERY.PID_REUSED` / `RECOVERY.LIVENESS_UNKNOWN` | the recorded pid now belongs to something else, or liveness can't be read | the harness refuses to act (fail closed); run `status`, then `stop` |
| VM will not boot / SSH timeout | broken task overlay | `reset`, then `start` |
| Golden image damaged | provisioning interrupted | `provision` again (rebuilds golden; your login on the separate home disk is kept) |
| `AUTH.LOGIN_EXPIRED` / `OWNER_AUTH_EXPIRED` | your Claude login in the VM ended | O-2 again |
| `SUBSCRIPTION.STATE:exhausted` | five-hour/weekly allowance used up | nothing; waits for the provider's reset time (or 15 → 60 min backoff when none is reported) and resumes |
| `AUTH.EXTRA_USAGE_ENABLED` / `unauthorized_billing` | the provider reported usage credits on/in use, or an API key was active | turn usage credits off in claude.ai Settings → Usage; then O-3 again |
| Controller/laptop restarted | a supervised VM may still be running | `status` shows it from host facts; `stop` or `reset` ends it. (Lease re-issue on reattach is a D3.4 orchestrator step; the primitive exists in `worker-lifecycle.mjs`.) |

Emergency stop: `node scripts/developer-harness-v3/bin/dh3.mjs stop` (graceful → QMP quit → kill of the task-owned supervisor, whose Job Object makes
Windows kill QEMU). It never touches any other process.

## 4. What is and is not proven

See 15 (isolation acceptance matrix), 13 (calibration) and 17 (GO/NO-GO). A green PR does not establish runtime isolation.
