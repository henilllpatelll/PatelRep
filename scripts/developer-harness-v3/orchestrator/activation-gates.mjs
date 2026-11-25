// Developer Harness V3 (D3.4) — the activation-gate register. Live (unattended, real-model) execution is allowed ONLY when EVERY gate is `closed`.
// D3.4 closes none of them: it prepares what it can (`prepared`) and says exactly what remains. A gate is never closed by this module's own code — closing one
// is an owner/independent-verifier act recorded in a later phase; the status values below are therefore data the owner changes by reviewed commit.
//
// status: open (nothing done) · prepared (D3.4 delivered the code/proposal, activation still needs the named owner step) · closed (verified, with evidence).
export const GATES = Object.freeze([
  { id: 'G-WORKER-ACCOUNT', title: 'Dedicated low-privilege Windows account for the worker (O-7)', status: 'open', d34: 'none (QEMU still runs as the owner)', owner_step: 'create `dh3-worker`, grant it only %LOCALAPPDATA%\\PatelRep\\dh3\\workers, launch the supervisor through a scheduled task as that user', source: '17 §3.2' },
  { id: 'G-FULL-WORKER', title: 'Full 3 GB worker admitted and validated on this host', status: 'open', d34: 'engine admission uses the D3.3 governor unchanged; no real worker was admitted', owner_step: 'close memory-heavy applications, run `dh3 provision` + `verify-isolation` at the full size', source: '17 §1, 13' },
  { id: 'G-CRED-ISOLATION', title: 'Credential isolation (the Claude login is the only credential in the worker; sanitizer + residue checks proven under the real account)', status: 'open', d34: 'checkpoint/snapshot credential scanning (snapshot.mjs); no change to the guest', owner_step: 'owner login inside the worker (O-2) then re-run the residue scenarios', source: '15, 16' },
  { id: 'G-EGRESS-FIREWALL', title: 'Outbound firewall rule for QEMU as defence in depth (O-6)', status: 'open', d34: 'none', owner_step: 'add the Windows Defender Firewall outbound rule for the QEMU binary', source: '17 §3.3' },
  { id: 'G-PROVIDER-AUTH', title: 'Provider authorization of the continuously unattended subscription-backed architecture (V3-T18)', status: 'open', d34: 'evidence, date, terms and uncertainty recorded in 20-d34-provider-eligibility.md; NOT a grant', owner_step: 'an independent decision that the exact architecture is permitted; owner consent is not provider authorization', source: '17 §4, 20' },
  { id: 'G-OWNER-AUTH', title: 'Owner native Claude authentication inside the worker (O-2)', status: 'open', d34: 'none; no credential handling added', owner_step: '`dh3 login` interactively', source: '16' },
  { id: 'G-EXTRA-USAGE', title: 'Extra-usage (usage credits) verified OFF (O-3)', status: 'open', d34: 'engine admission re-checks the verified-off fact on every AI stage (D3.3 admitAiWork)', owner_step: '`dh3 attest-extra-usage-off` + `probe-subscription`', source: '07, 17' },
  { id: 'G-ISSUER-KEYS', title: 'Trusted issuer keys generated and registered through the policy bootstrap ceremony', status: 'prepared', d34: 'key-custody.mjs (generate / ACL plan / registration, rotation, revocation proposals / emergency deactivation); test keys only', owner_step: 'owner root-of-trust ceremony (04), real keys, pinned policy revision', source: '04, 19' },
  { id: 'G-ISSUER-ACCOUNTS', title: 'One OS account per issuer role with restrictive ACLs and OS-enforced process identity', status: 'prepared', d34: 'issuer processes, authenticated IPC, ACL plan; peer SID is NOT verifiable from Node', owner_step: 'create per-role accounts, apply aclPlan(), run each issuer as its own account, verify with icacls', source: '19' },
  { id: 'G-ATTESTATION', title: 'Current signed isolation attestation from the delivery_verifier issuer', status: 'prepared', d34: 'issuer path implemented and REFUSES on the D3.3 probe-VM facts', owner_step: 'issue only after G-WORKER-ACCOUNT, G-FULL-WORKER, G-EGRESS-FIREWALL and a current acceptance run', source: '15, 19' },
  { id: 'G-V3-CI', title: 'V3 test suite wired into the protected CI gate', status: 'prepared', d34: 'exact workflow/runner proposal + digests (21)', owner_step: 'human-approved control-plane PR that updates the ci.yml pin', source: '09, 21' },
  { id: 'G-NEIGHBOR-TEST', title: 'Isolation tested with WSL/Docker neighbours ACTIVE', status: 'open', d34: 'none', owner_step: 'run verify-isolation while Docker Desktop and WSL are running', source: '17 §1' },
  { id: 'G-RESIDUALS', title: 'Remaining egress and credential residuals (Host-header/ECH fronting V3-T16; same-uid worker forgery of guest-relayed facts)', status: 'open', d34: 'documented only', owner_step: 'accept or close each residual in a reviewed decision', source: '03, 17 §2.2' },
  { id: 'G-D33-FOLLOWUPS', title: 'D3.3 follow-up findings without independent re-review (login relay N1/N2, lock-claim residual, no proxy back-pressure test, no QEMU hash pin)', status: 'open', d34: 'none (not touched)', owner_step: 'review and close', source: '17 §2' },
  { id: 'G-V2-PROVENANCE-FETCH', title: 'V2 provenance test no longer fetches from the network inside the test', status: 'prepared', d34: 'proposal moves the by-sha fetch into an explicit CI preparation step (21)', owner_step: 'human-approved change to the pinned ci.yml / test', source: '14-v2 §4 residuals' },
  { id: 'G-TRUSTED-GIT', title: 'authority/git-facts.mjs runs only a trusted, absolute, hardened git', status: 'prepared', d34: 'trusted-git.mjs + a reviewed patch proposal with digests (21); the issuer already uses it', owner_step: 'apply the patch through the owner-only authority change and re-pin', source: '17 §2.3 N5' },
  { id: 'G-CLI-EFFORT', title: '`--effort` / `--model` behaviour verified on the PINNED guest binary (2.1.331)', status: 'open', d34: 'host 2.1.332 help recorded; parser provided', owner_step: 'run parseCliHelp over `claude --help` inside the guest', source: 'routing.mjs CLI_EVIDENCE' },
  { id: 'G-LIVE-ADAPTER', title: 'A live session adapter (runSession) exists, is reviewed and has run end to end', status: 'open', d34: 'only the simulated adapter exists; the engine refuses live mode', owner_step: 'D3.9', source: '09' },
  { id: 'G-BYPASS-ACTIVATION', title: 'Bypass Permissions enabled ONLY inside proven isolation (V3 activation ceremony)', status: 'open', d34: 'never requested; routing forbids --dangerously-skip-permissions', owner_step: 'D3.9 owner ceremony', source: '09' },
])

export function liveExecutionAllowed(gates = GATES) {
  const open = gates.filter((g) => g.status !== 'closed')
  return { allowed: open.length === 0, open: open.map((g) => g.id) }
}

export function renderRegister(gates = GATES) {
  const rows = gates.map((g) => `| ${g.id} | ${g.title} | **${g.status}** | ${g.d34} | ${g.owner_step} |`)
  return ['| Gate | Requirement | Status | D3.4 contribution | Remaining step |', '|---|---|---|---|---|', ...rows].join('\n')
}
