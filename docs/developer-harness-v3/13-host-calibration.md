# Developer Harness V3 — 13 Host Measurement and Resource-Governor Calibration (D3.3)

All numbers were **measured on the owner's laptop on 2026-11-24** with read-only interfaces (CIM/WMI, `typeperf`, `powercfg`, `wsl --version/-l`,
`Get-NetAdapter` without MACs), while the owner's normal workload ran (Firefox ×15 ≈ 3.3 GB, VS Code ≈ 1.5 GB, this Claude session ≈ 0.9 GB,
ChatGPT, Defender). No application was stopped and no host setting was changed. Thresholds marked *judgement* are not stress-test results.

## 1. Host facts (compared with the D3.2 register)

| Fact | D3.2 (01 §4) | D3.3 measurement |
|---|---|---|
| OS | Windows 11 Home | Windows 11 Home 10.0.26200 x64 (same) |
| CPU | i7-13700H | i7-13700H, 14 cores / 20 logical (same) |
| RAM | 16 GB, ≈3.9 GB free | 16 077 MB visible; **2.6–4.0 GB available** across the session (avg 3.7 GB over a 15-sample series) |
| Commit | ≈35.5 GB limit | limit 35.5–37.3 GB (system-managed pagefile grows), committed 21.4 GB = **57–64 %** |
| Pagefile | system-managed, on | `C:\pagefile.sys` 19 456 MB allocated, 1.5 GB used (peak 1.8 GB), **AutomaticManagedPagefile = true** (unchanged) |
| Paging | not measured | idle 0–20 pages/s; spikes to ~2 000 pages/s for single samples |
| CPU | not measured | 3.5–16 % (avg 9.8 %) |
| Disk | ≈416 GB free | C: 952 GB NTFS, **412–416 GB free** |
| Power | — | Balanced; **AC sleep = never, AC hibernate = never** (DC: 3 h sleep); S0 Modern Standby |
| Hypervisor | running (VBS on) | HypervisorPresent = true; **VBS running, Memory Integrity (HVCI) running**, Credential Guard not running |
| Windows Hypervisor Platform | not checked | **disabled** (InstallState 2) → QEMU uses TCG until owner action O-1 |
| Virtual Machine Platform / WSL | present | enabled; WSL 3.0.5, kernel 6.18.58.1-1; distros `Ubuntu`, `docker-desktop` (both **Stopped** during measurement) |
| `.wslconfig` | 6 GB / 4 GB swap | `memory=6GB`, `swap=4GB`, `autoMemoryReclaim=gradual` (unchanged) |
| Docker Desktop | installed | installed, VM not running during measurement |
| Free hypervisors | none | none before D3.3; D3.3 installed user-scope **QEMU 11.1.3** (no driver, no admin) |
| Network | — | Wi-Fi + Hyper-V `vEthernet (WSL (Hyper-V firewall))` 172.26.x.x/20; host listeners on all interfaces include :3000 (node), :8000 (python), :5432/:5433 (postgres), :8080 (httpd), :445/:135 — all probed from the worker in scenario 3 |
| Firewall / Defender | — | all profiles enabled; Defender real-time on |

**Consequence:** the 6 GB VM proposed in D3.2 does not fit next to the owner's normal workload; even the 3 GB "full worker" floor does not fit
most of the time. The owner's WSL/Docker allowance (up to 6 GB + 4 GB swap when running) is treated as unowned load and is never reclaimed.

## 2. Calibrated thresholds (`runtime/resource-governor.mjs D33_THRESHOLDS`)

| Threshold | D3.2 proposal | D3.3 value | Basis |
|---|---|---|---|
| admit line (host available) | 4 096 MB | **2 048 MB** | measured normal available is 2.6–4.0 GB; 4 GB would never admit. Judgement: 2 GB is the least the owner's desktop keeps. |
| critical | 1 536 MB | **1 024 MB** | judgement; below this Windows trims working sets aggressively |
| commit ratio | 0.85 | 0.85 | measured 0.57–0.64; VM start also checks the post-start commit (QEMU commits guest RAM at start) |
| paging | 1 000 pages/s | **1 500 pages/s**, sustained over 3 samples | single-sample spikes to ~2 000 were observed under normal use; hysteresis (below) prevents a spike from flapping admission |
| CPU | 90 % | 90 % | measured ≤ 16 % |
| disk free | 20 GB | **40 GB** (+ 24 GB per VM virtual disk at VM start) | 412 GB free; generous margin |
| VM RAM | ≈6 GB target | ceiling 6 144, **sized from measurements**: floor 3 072 (full worker), 768 (probe/acceptance), 256 MB steps | the ceiling is a cap, never a target |
| VM overhead | — | 512 MB (TCG) / 384 MB (WHPX); Job Object cap = RAM + 640 / + 512 | judgement, checked against the QEMU working set during scenario 9 |
| host headroom after VM start | 2 GB | 2 048 MB | owner requirement: keep using the laptop |
| hysteresis | — | enter after 3 sustained samples; clear after 3 samples ≥ admit + 512 MB / commit − 0.03 | measured: a 1 957 pages/s spike left the state `clear` in all 15 samples |

D3.2's `DEFAULT_THRESHOLDS` (`calibrated: false`) are left untouched; D3.3 passes its calibrated values explicitly.

## 3. What this means in practice (measured admission outcomes)

| Request | Needs available | Measured outcome on 2026-11-24 |
|---|---|---|
| full worker (3 GB VM) | ≥ 5 632 MB | **waiting_resources** at every sample (`RESOURCE.MEMORY_HEADROOM_INSUFFICIENT`) |
| acceptance/probe VM (768 MB) | ≥ 3 328 MB | waited ~2–15 min at a time, then admitted when available rose to 3.3–3.6 GB |
| deterministic controller work | not critical | always admitted |

## 4. Sampler overhead and responsiveness

One `typeperf` call with two 1-second samples: **2.4–2.8 s wall, one short-lived ~10 MB process**; `tasklist` only when task-owned PIDs are watched.
Default cadence 15–60 s. `host_responsive` = the sampler returned within 15 s (all samples did). This is a conservative controller heartbeat,
not a measurement of the owner's UI latency.

## 5. Not measured

Behaviour under real memory exhaustion of the host (deliberately not induced on the live laptop) · WHPX overhead (not enabled) · Docker Desktop /
WSL running concurrently with the worker (both were stopped) · long-run (> 1 h) distributions.
