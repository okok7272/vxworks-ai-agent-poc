# Public PoC and next Agent scenario

Current core: Provider → EditLoop → PermissionManager → SdkBackend → WSL SDK/QEMU/wrdbg.
Future public/company providers share AgentProvider. CompanyAgentProvider is an offline placeholder;
no separate Public provider implementation is needed until its API contract is known.
ProviderContext now accepts optional knowledge excerpts; existing action types are reused.
The current fixed loop still calls analyze/repair, not the optional propose dispatcher.

Future company path: Company Provider or approved MCP adapter → same core → PermissionManager
→ future WorkbenchBackend → Workbench/wrdbg/Serial → actual target.
WorkbenchBackend, physical target access, MCP execution and Knowledge retrieval are not implemented.

Permission boundaries stay unchanged: read/search use host-authorized context; edits use write_file;
target run/stop require approval. Flash/memory write have no supported action/dispatch path (DENY).
Provider capability declarations never grant tool permissions.

Company onboarding still requires endpoint, authentication, model identifier, request/response schema,
Tool/Function Calling, MCP, RAG/File Search support and approved data transmission scope.
Public compatibility does not imply company API compatibility. No credentials or API calls are added.

## Publication state

Only original Agent code, synthetic Demo Controller, metadata examples and public documentation are intended
for publication. Local historical reports/evidence/runtime/build outputs and private knowledge are ignored.
SDK adapters now use Linux home and the distribution's default user, with optional private WSL environment
overrides. The existing SDK/test/application directory names and BSP are unchanged. Path resolution was
checked independently; historical SDK execution evidence was reused without rerunning integration tests.
Git ignore cannot remove already tracked content: inspect both tracked and untracked candidates before push.
The scanner is heuristic and cannot certify that arbitrary company data or every secret is absent.
No repository-wide license grant is added; owner should choose the project license before public release.

## Demo model scenario and future native/LLM path

The panel now implements the deterministic model scenario using the existing EditLoop and isolated copy.
See [Run Demo Scenario](DEMO_SCENARIO_USAGE.md). The native/RTP/LLM flow below remains future work.

Request: “DemoController에서 UDP timeout 이후 watchdog recovery가 정상적으로 동작하지 않는 원인을 찾아 수정하고 검증해줘.”

The current synthetic baseline recovers correctly. First check the premise. To demonstrate repair, create
an approved isolated working copy and seed a documented missing watchdog recovery assignment there.
Do not alter the baseline or claim an unobserved defect.

Planned flow: approved public source/context → document/source search → analysis → edit proposal
→ Permission → source edit → build/compiler feedback → bounded repair → approved RTP run
→ runtime feedback → host validation → PASS or evidence-based FAIL.

The Demo path now has a selected context adapter and exact-scope response validator. Its backend checks
only the reviewed source model; C compilation and RTP handoff are not implemented. The separate
RuleBased provider still generates the existing Hello fixture.

Suggested next Work prompt:

~~~text
Read docs/PUBLIC_POC.md, docs/AGENT_PROVIDER_CONTRACT.md and demo/controller docs.
Reuse existing PASS evidence; do not run Full Validation or the old SDK/regression suites.
Use only public demo files. Analyze the UDP timeout/watchdog recovery request; the baseline is healthy.
First prepare a minimal offline context/response adapter and an isolated, explicitly seeded defect fixture.
Preserve PermissionManager, bounded retries and evidence. Do not connect any API until its data/contract
scope is confirmed. Do not touch the SDK, Linux scripts, original Hello World or any actual board.
Run only changed contract/host tests. Explain the need before introducing a new SDK/RTP integration run.
~~~
