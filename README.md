# VxWorks AI Agent Public PoC

A public experiment in source analysis/edit → build → compiler feedback → rebuild
→ VxWorks execution → runtime feedback → evidence-based validation.

Current execution: Windows VS Code → AgentProvider → Agent Edit Loop → PermissionManager
→ SdkBackend → WSL → VxWorks SDK/QEMU → wrdbg → isolated demo RTP.
The existing validated RTP loop uses a generated Hello fixture. **Run Demo Scenario** now runs the
separate Demo Controller recovery scenario through the same Edit Loop using a safe model backend.
This is not C compilation or an RTP execution. [Click-by-click guide](docs/DEMO_SCENARIO_USAGE.md).

Future: Public LLM or Company GPT → same core → future WorkbenchBackend / actual target,
with private controller knowledge supplied separately. No external LLM API is connected.
This Public PoC contains no actual company controller source/documents/logs.

## Public components

- [Demo Controller](demo/controller/README.md): logical UDP task, timeout, watchdog recovery and status.
- [Knowledge metadata](knowledge/README.md): original fixtures, controller scope and confidence; no RAG/indexing.
- [Provider contract](docs/AGENT_PROVIDER_CONTRACT.md): deterministic provider, optional planning/context,
  offline Company placeholder and tool boundary.
- [Public LLM boundary](docs/PUBLIC_LLM_PROVIDER.md): vendor-neutral transport, strict Demo responses;
  Panel Public LLM selection is NOT CONFIGURED. No API connection is installed.
- [Public/company boundaries and next scenario](docs/PUBLIC_POC.md).

ProviderContext supports selected knowledge excerpts; existing analyze/repair and deterministic behavior remain.
Provider → Edit Loop → PermissionManager → Tool/Backend is mandatory. Source edit and target run/stop
require existing permissions. Flash/memory write have no supported execution path.

## Local development

Use existing dependencies and run npm run compile. In Windows VS Code press F5 and choose
Run VxWorks Agent Extension. Open VxWorks Agent: Open Panel. The default backend is mock.
SDK mode requires the already configured Linux SDK and scripts under the selected Linux user's home.
WSL defaults to Ubuntu-22.04 and its default user. Optional private process environment overrides are
VXWORKS_WSL_DISTRO and VXWORKS_WSL_USER. Existing SDK tasks use Ubuntu-22.04's default user.
SDK binaries, kernels and vendor documents are not distributed by this repository.

Quick checks for this change (no SDK/QEMU execution):

~~~text
npm run compile
node --test dist/test/provider-knowledge.test.js
node tools/check-public-poc.cjs
~~~

Historical local evidence remains under artifacts/ and is excluded from Git. Existing SDK/Agent Loop PASS
results are reused; current metadata/fixture checks do not claim a new VxWorks integration run.
Machine-specific usage reports remain local and are excluded from publication.

## Publication boundaries

Do not commit credentials, .env, SDK/vendor binaries or PDFs without explicit redistribution rights,
portable VS Code runtimes, build outputs, temporary logs or CompanyKnowledge.
Store future company knowledge externally in a private administrator-selected directory.
Manifest metadata may reference a verified official vendor URL; it does not authorize copying the material.

Run the offline candidate inspection before staging/pushing and review its findings. It checks tracked and
untracked candidates when Git exists and filesystem candidates otherwise. It is not a complete secret detector.
SDK adapters derive paths from Linux home; no developer username is stored in public configuration.
Required directory names and the verified BSP remain specific to the supported SDK configuration.
No company endpoint/authentication/model identifier is assumed and no repository license is selected for the owner.

[First publication preparation and configuration](docs/PUBLICATION.md).

Next: use the same Demo context/response boundary with an approved Public LLM provider after confirming
its API contract and data-transmission scope. The deterministic model scenario is available in the panel;
native/VxWorks execution and actual LLM integration remain separate future work.
