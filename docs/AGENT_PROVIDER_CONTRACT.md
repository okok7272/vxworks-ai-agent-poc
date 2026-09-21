# AgentProvider 계약 준비

이번 단계는 오프라인 계약 준비다. HTTP/API, endpoint, 인증, 모델 ID, 외부 SDK를 추가하지 않았다.
CompanyAgentProvider는 UI에 등록하지 않았으며 실행 Provider는 기존 RuleBasedAgentProvider다.

## 조사 결과와 최소 변경

- 별도 AgentManager는 없다. extension.ts가 RuleBasedAgentProvider를 AgentEditLoop 생성자에 주입한다.
- AgentEditLoop는 AgentProvider 인터페이스의 analyze/repair를 호출한다. 이미 교체 가능한 경계다.
- 기존 MockAgentProvider는 AgentController로 수동 명령을 전달하는 별도 경로다.
- AgentController와 AgentEditLoop는 각각 PermissionManager를 거친 뒤 backend를 호출한다.
- analyze/repair, 기존 Plan/EditProposal/RepairContext, 실행 루프, deterministic 코드는 변경하지 않았다.
- AgentProvider에 선택적 capabilities/propose를 추가했다. registry나 새 manager는 만들지 않았다.

## 계약

src/agent/ProviderContract.ts:

| 타입 | 전달 내용 |
|---|---|
| ProviderContext | 사용자 LoopRequest, source/content/hash, compiler stdout/stderr/exitCode, runtime console/output/completed, 이전 iteration 요약 |
| ProviderAction | ANALYZE, READ, SEARCH, EDIT, BUILD, RUN, VALIDATE, COMPLETE, ABORT의 구분 가능한 union |
| ProviderDecision | 다음 action과 선택적 assessment |
| ProviderAssessment | PASS/FAIL/UNKNOWN, 이유, host가 대조할 evidence ID |
| ProviderCapabilities | chat, structuredOutput, toolCalling, mcp, fileSearch 각각 supported/unsupported/unknown |

EDIT는 기존 EditProposal을 재사용한다. 임의 OS command, target 주소, debugger command를 반환하는 필드는 없다.
capability 생략은 unknown으로 해석한다. capability는 기능 설명이며 실행 권한이 아니다.

**현재 연결된 계약:** analyze(request, signal) → Plan,
repair(source/diagnostic/actualOutput/iteration, signal) → EditProposal.

**이번에 준비한 계약:** propose(context, signal) → ProviderDecision.
현재 고정 EditLoop는 propose를 호출하거나 반환 action을 dispatch하지 않는다.
확장 context도 아직 loop가 수집·전달하지 않는다. 따라서 READ/SEARCH/BUILD/RUN 등을 새로 실행할 수 없다.
기존 동작을 보존하면서 향후 adapter/host 연결 위치만 정의한 것이다.

실제 연결 전 host가 허용된 context snapshot을 구성하고, 전송 범위를 확인하고, 응답을 unknown으로 받아
runtime schema/크기/경로/허용 action을 검증해야 한다. TypeScript 타입만으로 외부 응답을 신뢰하면 안 된다.
Provider의 COMPLETE/PASS는 제안이다. 최종 PASS는 host의 실제 build/runtime evidence로만 확정한다.

## Company GPT 연결 위치

src/agent/CompanyAgentProvider.ts가 placeholder다. capabilities는 전부 unknown이다.
analyze/repair는 미연결 오류를 던지고 propose는 ABORT를 반환한다. AbortSignal도 확인한다.
자동 fallback, 인증 요청, 네트워크 transport는 없다.

향후 회사에서 확인할 정보:

1. 승인된 API endpoint와 폐쇄망 접근 조건
2. 인증 방식, 자격 증명 보관/갱신 정책
3. 정확한 model identifier (GPT-5.5라는 표시명을 API ID로 가정하지 않음)
4. Tool/Function Calling 지원 여부 및 schema
5. custom MCP 지원 여부, 실행 주체와 접근 허용 범위
6. RAG/File Search 지원 여부 및 데이터 보관 정책
7. request/response schema, 오류/streaming/취소 방식
8. source code, compiler/runtime 로그 및 문서의 전송 허용 범위

OpenAI public API와 동일한 endpoint, 인증, schema라고 가정하지 않는다.
정보 확인 후 이 클래스 또는 이를 대체하는 adapter에 transport를 구현한다.

## Tool / Permission 보안 경계

Provider → EditLoop → PermissionManager → Tool/Backend.
Provider 입력에는 backend, PermissionManager, 파일 핸들, 실행 callback, credential을 주지 않는다.

| 작업 | 경계 |
|---|---|
| read/search | 현재 허용된 context만 사용. 범용 read/search tool은 미구현; 추가 시 기존 workspace/경로 정책에 맞춰 host에서 허용 |
| source edit | 기존 write_file ASK, 경로·해시 검증 유지 |
| target run/stop | 기존 target_run/target_stop ASK 유지 |
| build/debug | 기존 AUTO 정책과 소유 자원 제한 유지 |
| flash write / memory write | DENY: action/dispatcher/backend 실행 경로를 제공하지 않음 |

모델 출력/문서/로그는 비신뢰 데이터다. tool 요청도 host allowlist와 PermissionManager를 거쳐야 한다.
이 TypeScript 경계는 악성 extension 코드를 격리하는 OS sandbox가 아니다. 향후 adapter 구현에도
직접 fs/child_process/backend 호출을 넣지 않는 코드 검토와 응답 검증이 필요하다.

## 향후 MCP / Offline Knowledge

MCP는 두 연결점을 구분한다: provider의 지원 capability와 host의 승인된 tool adapter.
지원 여부가 확인되더라도 MCP가 PermissionManager를 우회해 target을 실행하게 해서는 안 된다.
현재 MCP client/server/tool 실행은 구현하지 않았다.

KnowledgeProvider (향후 별도 계층):

- VxWorks 공식 PDF
- Hardware/CPU PDF
- Controller Knowledge: controller ID별 격리, VERIFIED / INFERRED / UNKNOWN 구분

KnowledgeProvider → host context assembler → ProviderContext → AgentProvider.
ProviderContext.knowledge에 선택적 발췌 타입을 준비했다. controller ID, source, version,
documentType, confidence, content를 표현하며 실제 검색·수집·전송은 아직 연결하지 않았다.
공개 manifest와 Demo fixture는 [Public PoC](PUBLIC_POC.md)를 참고한다.
다른 controller의 근거를 섞거나 INFERRED를 VERIFIED로 승격하지 않는다.
이번에는 KnowledgeProvider interface, RAG, PDF indexing을 구현하지 않았다.

장기 구조는 CompanyAgentProvider → EditLoop → PermissionManager → WorkbenchBackend
→ Workbench/wrdbg/Serial → VxWorks Target이다. WorkbenchBackend/실제 target 경로는 **향후 설계**이며,
현재 검증된 backend는 SdkBackend/QEMU다. 이번 작업은 Workbench나 실제 보드에 접근하지 않는다.

## Quick Validation 및 다음 단계

허용된 검증만 실행: npm run compile, node --test dist/test/provider-contract.test.js.
기존 16개 테스트, SDK build, QEMU, wrdbg, RTP, Full Validation은 실행하지 않는다.
새 테스트는 legacy 호환, context/EDIT 계약, placeholder fail-closed, 취소를 확인한다.

다음 단계는 회사 API 계약 확인 및 승인된 예제 응답을 이용한 오프라인 schema 검증이다.
그 뒤에만 context assembler, 응답 validator와 선택적 dispatcher를 추가하고 관련 contract 테스트를 확장한다.

실행 결과: TypeScript compile PASS, 새 contract 테스트 4/4 PASS. 기록은 로컬 artifacts에 보존하며 Git 공개 대상에서는 제외한다.
