# Developer Harness V3 — 20 Provider eligibility record (revalidated 2026-11-25)

**Conclusion: provider authorization of the exact continuously-unattended architecture is NOT established. Owner consent is not provider authorization. Live unattended execution stays disabled (gate G-PROVIDER-AUTH).** Nothing here is legal advice; it records what the official pages say, when they were read, and what they leave open.

Method: a research-only agent fetched the official Anthropic pages below on 2026-11-25 (WebFetch). Two fetches (Consumer Terms §3, Monthly API credits) came back **summarised**, so their sentence-level wording must be re-read on the live page before anyone relies on it. Support pages show only relative "updated N weeks ago".

| Source | Date shown | What it says (short quotes) | Establishes |
|---|---|---|---|
| anthropic.com/legal/consumer-terms §3 item 7 | Effective Oct 8, 2025 (version history not read) | "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise." §12: suspension "if we believe that you have breached these Terms" | automation is **prohibited by default**; exceptions are an API key (forbidden to this harness by the owner's constraints) or explicit permission (undefined) |
| code.claude.com/docs/en/legal-and-compliance | none | "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and the Agent SDK." · "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription…" · developers "may not collect, store, or intermediate Claude.ai credentials or session tokens" · "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice." | signing in to the **unmodified** binary with one's **own** subscription is not what the authentication section restricts; limits are defined by "ordinary, individual usage"; credential extraction is forbidden; enforcement can be silent |
| code.claude.com/docs/en/authentication | none (mentions v2.1.318) | `CLAUDE_CODE_OAUTH_TOKEN`: "Use this for CI pipelines and scripts where browser login isn't available" · "Renewing early matters most for sessions that run unattended." · in `-p` mode a present `ANTHROPIC_API_KEY` "is always used" | unattended/scripted subscription use is **documented as a feature**; a stray API key silently switches billing |
| code.claude.com/docs/en/headless | none | `--permission-prompts none` "for example in a scheduled job"; `--bare` "doesn't use your subscription login" and "will become the default for -p in a future release" | headless/scheduled use is documented; **a future `-p` default that ignores subscription login could break this design** |
| support.claude.com/en/articles/15036540 (Agent SDK with your plan) | notices dated **Oct 7, 2026** and Jun 15, 2026 | Oct 7: "Nothing changes for your plan: when you're signed in with your Claude plan, the Claude Agent SDK and claude -p still draw from your subscription limits." Jun 15: changes "paused… For now, nothing has changed" | the **2026-10-07 update exists**; plan sign-in `-p` / SDK usage draws from subscription limits; the June pause is explicitly "for now" |
| support.claude.com/en/articles/17154008 (monthly API credits) | relative only | credits cover `-p`/SDK "when you run them yourself with an API key"; plan sign-in "doesn't use your API credits" | API credits are an **API-key** path — prohibited here |
| support.claude.com/en/articles/12429409, code.claude.com/docs/en/costs | relative only | usage credits "apply to… Claude Code terminal usage"; "you can disable usage credits at any time" (`/usage-credits`) | extra usage can bill past limits and can be turned off; the harness requires it verified OFF (G-EXTRA-USAGE) |
| code.claude.com/docs/en/scheduled-tasks | none | desktop scheduled tasks "run locally on your machine" for unattended cron-driven automation | local unattended scheduled automation is an Anthropic feature — of the *desktop app*, not evidence about a custom controller |

## What is established
Headless `claude -p` with `--output-format stream-json`, scripted/CI and scheduled use, `setup-token`, and unattended sessions are **documented features**; the 2026-10-07 update confirms plan-signed-in `-p` still draws from subscription limits; extra usage can be disabled.

## NOT established (the reason the gate stays open)
1. No page defines "ordinary, individual usage" or says whether a **continuous back-to-back loop with no human present** is inside it.
2. No page says the documented headless/CI features are Anthropic's "explicit permission" for the Consumer Terms automation exception. That is a legal reading, not a statement.
3. The Agent SDK overview says it is governed by the **Commercial** Terms; how that interacts with a personal Pro/Max subscription is not addressed. The Consumer Terms version history was not read.
4. Nothing official on how a subscription account running many sessions is **throttled or enforced against**.

## Contradicting / risk signals
Default prohibition of automation; "should use API key authentication" guidance for programmatic use; `--bare` becoming the `-p` default; silent enforcement; the "for now" language.

## What D3.4 therefore does
* Keeps live execution disabled (engine refuses `live`); records this as gate **G-PROVIDER-AUTH** = open.
* Uses the **unmodified official binary** only; no setup-token handling, no credential extraction or relay, no API key, no billing change, no alternative account (all refused in `routing.checkInvocationSafety` and the launcher). The login relay of D3.3 passes the *interactive* login through; it never stores a token.
* Preserves shared headroom for the GitHub workflows (`GOVERNOR_DEFAULTS.shared_headroom`).
* Re-check triggers before any activation decision: the Consumer Terms version history; the `--bare`-default release note; the June "paused" notice; a written answer from Anthropic if the owner wants certainty.
