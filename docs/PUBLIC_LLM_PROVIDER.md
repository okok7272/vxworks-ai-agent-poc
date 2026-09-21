# Public LLM provider boundary — offline only

No API/HTTP client, endpoint, key, external SDK or network request is implemented.
MockLLMTransport returns explicitly supplied JSON strings in memory. ChatGPT Work is not assumed to be
an HTTP API. CompanyAgentProvider remains a separate offline placeholder.

## Structure

Host-selected DemoContext → PublicLLMAgentProvider → LLMTransport.send(JSON, AbortSignal)
→ raw string → strict response validation → existing Plan/EditProposal
→ AgentEditLoop → PermissionManager → isolated backend → host validation/evidence.

The transport receives only serialized data and a cancellation signal: no file handles, shell tools,
backend objects, credentials or permission callback. No filesystem/network transport is installed.
Mock requests stay in memory; the product does not automatically save full prompts/raw responses.

The existing deterministic DemoProvider, DemoRunner and SDK execution code are unchanged.
PublicLLMAgentProvider implements analyze/repair for the existing fixed EditLoop. It accepts a host-prepared
defective public fixture as context; it does not prepare files or inject a defect itself.
Its test integration uses a counting mock backend, not the full Demo scenario or native C execution.

## Selected context

Reuses demoContext: one main.c with source hash; controller ID/title/scenario; user request;
selected ARCHITECTURE, NETWORK_SPEC and REQUIREMENTS excerpts; build/runtime diagnostics;
at most five previous iteration summaries. Optional knowledge preserves id/title/source/version,
controller/documentType/confidence (VERIFIED, INFERRED, UNKNOWN).

Only the three approved public Demo document references and controller are accepted. No repository traversal.
Unknown top-level context fields are omitted by explicit projection; arbitrary source paths and cross-controller
knowledge are rejected. Source content limit: 32 Ki characters; serialized request limit: 64 KiB.
These are transport safety limits, not estimates of any model's token capacity.

The host must still approve future external transmission. A schema validator is not a sensitive-data classifier.
Documents, comments and logs are untrusted data, never instructions authorizing tools.

## Response schema

Exactly these root fields are required:

- analysis: nonempty summary (up to 4000 characters).
- targetFile: exactly main.c.
- expectation: exactly communication state recovered.
- confidence: VERIFIED / INFERRED / UNKNOWN; advisory only.
- decision: exactly one action object, using existing ProviderAction variants below.

EDIT: action contains kind and proposal; proposal contains source and reason only.
The full proposed source must match the current source with exactly the existing Demo watchdog timestamp
repair applied. Additional edits, path changes or permission/tool fields are rejected.

COMPLETE: action contains kind and assessment {status, reason, evidenceIds}; assessment is advisory.
ABORT: action contains kind and reason.
All nested response objects reject additional/missing fields. Empty/non-JSON/markdown responses, unsupported
actions, excessive response size and malformed edits produce ProviderResponseError.

Current analyze/repair requires EDIT. ABORT fails explicitly; COMPLETE cannot return a successful Plan or
skip build/validation. READ/SEARCH/BUILD/RUN requests are not dispatched by this Provider.
The host alone determines PASS using evidence, regardless of model confidence or completion claims.

Local timeout defaults to 15 seconds (maximum 30). Cancellation propagates to the transport and bounds
waiting even if a test transport ignores the signal. No transport retries are implemented.
The existing EditLoop retains its separate retry/iteration/time limits.

## Panel

Demo Agent choices: **Deterministic Demo Agent** (default) and **Public LLM**.
Selecting Public LLM displays **NOT CONFIGURED**, disables Run Demo Scenario, and does not instantiate a
transport or attempt a connection. The host command independently refuses execution; UI disabling is not
the security boundary. Switching back restores the existing deterministic path.
Selection is session-local. No credential setting or .env file was introduced.

## Required information before a real adapter

All values are currently UNKNOWN/TODO:

| Public provider | Required confirmation |
|---|---|
| Endpoint/authentication | Exact approved endpoint, auth method and credential storage policy |
| Model | Exact model identifier; do not infer it from a display name |
| Schemas | Request/response envelopes, structured output and Tool/Function Calling support |
| Streaming | Whether supported, framing, assembly and cancellation behavior |
| Reliability | timeout/retry/backoff/idempotency policy and rate limits |
| Capacity | Context/token limits, output budget and usage/cost limits |
| Data | Approved source/log/document transmission scope and retention/storage policy |

Company additionally requires internal endpoint/auth/model identifier, Tool/Function Calling, MCP,
RAG/File Search, request/response schema, whether source may leave the company, and log/data retention rules.
Do not assume compatibility with any public provider's API.

## Validation and next work

TypeScript compile PASS; six new contract tests PASS: mock success, strict invalid-response rejection,
context scope/budget, fail-closed/cancellation/timeout, existing loop permission boundary and Panel gating.
No SDK/QEMU/wrdbg/RTP/native Demo compile, Full Validation or old regression was executed.

Next: confirm API and data policy, then implement one transport with offline envelope fixtures first.
Add an explicit host context handoff/provider selection with bounded timeout and evidence summaries;
retain this validator, PermissionManager and isolated copy. Only then run an explicitly authorized public
Demo judgement experiment. A model-backend PASS must remain labelled simulated; it is not VxWorks evidence.

Suggested next Work:

~~~text
Read docs/PUBLIC_LLM_PROVIDER.md. First confirm the real provider endpoint/auth/model/schema and public
source transmission/retention policy; do not guess a ChatGPT Work API. Implement only the approved transport
and host Demo handoff, preserving strict structured responses, permissions, isolated edits and evidence.
Reuse SDK PASS evidence. Test changed adapters offline first; no Full Validation or old regression.
After explicit data/connection authorization, run one real LLM judgement against the public Demo model,
reporting model validation separately from native/VxWorks execution.
~~~
