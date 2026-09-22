# OpenAI Responses transport

The optional real transport is implemented; no real API or live LLM Demo scenario was executed during this change (the process had no `OPENAI_API_KEY`). Deterministic Demo remains the default. MockLLMTransport remains available.

## Boundary and configuration

PublicLLMAgentProvider → OpenAIResponsesTransport → native fetch → `https://api.openai.com/v1/responses`.
No OpenAI SDK, new dependency, endpoint override, automatic retry, streaming, or tool calling. HTTP and the Demo provider have a 30-second timeout; Cancel propagates to the HTTP AbortSignal. Redirects are rejected. `store: false` is sent; this does not make a claim about service-side retention or account data policies.

The model defaults to `gpt-5.6-luna`; change it with process environment variable `VXWORKS_AGENT_OPENAI_MODEL`. Model availability, account entitlement, billing and live output quality remain unverified. READY means a nonempty process key and syntactically valid model setting exist, **not** that authentication or model access has been tested. Missing key or invalid model means NOT CONFIGURED, with no request.

Only `OPENAI_API_KEY` supplies authentication. The key goes in the Authorization header; it is not put into prompts, settings, files, evidence or logs. Errors discard remote bodies, fetch exceptions and their causes, retaining only a generic failure or HTTP status. Reflected keys are rejected. `.env` and `.env.*` are already ignored; the extension does not create or load them.

Uses the official [Responses Structured Outputs format](https://developers.openai.com/api/docs/guides/structured-outputs) and the requested [model identifier](https://developers.openai.com/api/docs/models/gpt-5.6-luna). JSON Schema requires the existing fields: analysis, targetFile, expectation, confidence, decision.action. EDIT / COMPLETE / ABORT are the only actions. The existing local validator then rejects unknown fields, paths other than main.c, unsupported edits, commands and permission bypass. COMPLETE cannot substitute for host validation.

## Context and evidence

The existing adapter selects the public Demo main.c, three short architecture/network/requirements excerpts, public controller metadata, model diagnostics and previous iteration summaries. No repository scan, SDK input or company context is passed. The transport refuses oversized input and recognizable credentials/private paths. This guard is not a universal secret classifier: keep this fixture and its selected documents public; do not substitute private material.

DemoRunner still seeds the defect locally in its isolated copy. Only the subsequent recovery judgement uses the selected transport. Each edit, including the initial defective copy, still crosses PermissionManager. The transport receives no filesystem/backend/permission objects. Demo validation remains the restricted local model (no native C build, SDK or target execution). Only the known single-line watchdog repair is supported.

Existing `artifacts/demo-run-*/agent-context.json` records selected context with source path/hash instead of source content; result/diff/validation evidence is retained and ignored by Git. The provider ID distinguishes OpenAI judgement. Requests, raw HTTP responses, headers and credentials are not saved. The smoke command only prints a compact result; it creates no source/evidence dump.

## Set the key without a literal in shell history

Close all existing VS Code windows first so a reused VS Code process cannot retain its old environment. In a new Windows PowerShell opened at the project directory:

```powershell
$secureKey = Read-Host 'OPENAI_API_KEY' -AsSecureString
$credential = [System.Net.NetworkCredential]::new('', $secureKey)
$env:OPENAI_API_KEY = $credential.Password
$credential = $null
$secureKey.Dispose()
$env:VXWORKS_AGENT_OPENAI_MODEL = 'gpt-5.6-luna'
code --new-window .
```

Paste the key only into the masked prompt, never into chat, settings, a command literal or `.env`. This uses process memory and child-process inheritance; it does not persist the key with `setx`. After closing VS Code, remove the shell copy with `Remove-Item Env:OPENAI_API_KEY`. Removing it in the shell does not erase an already running child's environment.

## Smoke only — before the future Demo

In Extension Development Host, open **VxWorks Agent: Open Panel**, select **Public LLM**, then click **Test Public LLM Connection** (or run **VxWorks Agent: Test Public LLM Connection** from the Command Palette).
This uses the Extension Host environment, not an unrelated terminal/Work process. One explicit invocation sends one tiny smoke request when configured; no retries. Missing key sends zero requests. Pending duplicate clicks are ignored. It never runs the Demo, edit permissions, build or backend tools.
The Panel shows `API: CONNECTED`, OpenAI, the requested model and `Structured Validation: PASS`, or `API: FAILED` with HTTP status when available and a fixed redacted error. READY remains configuration-only; CONNECTED requires the validated response. No connection evidence/log file is written. The model displayed is the actual request model, not a claim about a server-side model snapshot.

With the current compiled output, run once in that same PowerShell:

```powershell
node tools/smoke-openai.cjs
```

No key: SKIPPED, no HTTP. With key: one short request asks for ABORT; parse and the existing validator must succeed. No public source, edit, build or tools are involved. Failure is reported without raw server content; there is no retry. Authentication/model/network failures require checking account access/settings outside this project.

## Future real LLM judgement Demo (not run in this work)

1. Open the project in the VS Code instance started above.
2. F5 → **Run VxWorks Agent Extension**.
3. In the new Extension Development Host, run **VxWorks Agent: Open Panel**. No Folder Opened is supported for this public Demo only: baseline is read from the extension's demo/controller, and each isolated session is created under extension artifacts/demo-session-*/artifacts/demo-run-*. Baseline reads reject paths/junctions escaping the extension/controller. Existing untrusted workspaces remain blocked. Production and general Agent/Edit Loop keep their trusted-workspace requirement.
4. Select **Public LLM** in the Demo Agent dropdown. Check **READY**, Provider: OpenAI and the intended model. Selection alone sends nothing.
5. Click **Run Demo Scenario**. This explicitly sends the selected public Demo context when recovery judgement is needed.
6. Review/approve the existing **write_file** and model run/cleanup permission dialogs, including the proposed repair diff. A denial stops the loop.
7. Inspect PASS/FAIL, **Show Diff** and **Show Evidence** in the Demo section. **Cancel** aborts a pending request and retains evidence.

PASS here means LLM judgement plus simulated Demo validation, not VxWorks execution. Model refusals, timeout, response truncation or a different edit fail closed. Company provider, MCP and private Knowledge remain separate, unconfigured future integrations.

## Quick Validation

Only TypeScript compile and the new mock-HTTP transport/Panel/handoff contracts are exercised. Tests cover serialization, parsing, strict local validation, missing key, cancellation/timeout, secret-safe errors, smoke, proposal handoff/baseline protection and Panel READY gating. Existing SDK/QEMU/RTP/Demo scenarios and regression suites are not rerun.

Recorded result: TypeScript compile PASS. Nine new contract tests PASS (eight passed on the first run; the handoff test's incorrect static `require` assertion was corrected to the existing `authorize` boundary and that test alone passed on rerun). The initial optional-environment/literal-type compiler errors were fixed before the successful compile. No real HTTP smoke request or Demo scenario was executed. Resumption reused these results rather than repeating passed tests.
