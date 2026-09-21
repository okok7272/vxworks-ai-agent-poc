# Run Demo Scenario

## 클릭 순서

1. Windows VS Code에서 이 프로젝트를 연다. 기존 의존성을 사용한다.
2. workspace setting vxworksAgent.backend를 **mock**으로 둔다. SDK 모드의 기존 자동 환경 검증을 피하기 위함이다.
3. F5 → **Run VxWorks Agent Extension** 선택.
4. 새 Development Host에서 신뢰하는 로컬 workspace를 연다.
5. **VxWorks Agent: Open Panel** 실행. Development 모드에서는 자동으로 열린다.
6. Demo 영역의 **Controller: Demo Controller**, **Agent: Deterministic Demo Agent**,
   **Backend: Demo/Mock (model only)**를 확인한다.
   Agent 선택의 **Public LLM**은 NOT CONFIGURED 상태이며 실행/외부 연결을 하지 않는다.
   기존 Demo를 실행하려면 **Deterministic Demo Agent**를 선택한다.
7. **Run Demo Scenario**를 클릭한다. 터미널 명령 입력은 필요 없다.
8. 격리된 결함 복사본 생성 및 복구 수정에 대한 write_file 승인을 확인한다.
   기존 loop의 target_run/target_stop 승인도 유지되지만, 승인 문구대로 로컬 모델만 실행한다.
9. **PASS**, iteration 2, Build PASS (model check), Validation PASS,
   Expected/Actual 모두 communication state recovered인지 확인한다.
10. Demo 영역의 **Show Diff**, **Show Evidence**로 변경과 result.json을 연다.
    진행 중 **Cancel**로 중단할 수 있다. 승인 알림이 떠 있어도 Cancel 버튼은 활성 상태다.

기존 Agent Loop 영역의 버튼과 혼동하지 않는다. SDK/수동 backend 선택과 무관하게
Run Demo Scenario는 항상 DemoBackend를 사용한다. 새 LLM/API는 연결하지 않는다.

| Palette command | ID |
|---|---|
| VxWorks Agent: Run Demo Scenario | vxworksAgent.runDemoScenario |
| VxWorks Agent: Cancel Demo Scenario | vxworksAgent.cancelDemoScenario |
| VxWorks Agent: Show Demo Diff | vxworksAgent.showDemoDiff |
| VxWorks Agent: Show Demo Evidence | vxworksAgent.showDemoEvidence |

## 동작과 증거

DemoRunner → DemoProvider/context/response adapters → **기존 AgentEditLoop** → PermissionManager
→ DemoBackend. SDK/QEMU/wrdbg/backend는 생성하거나 호출하지 않는다.

iteration 1: read-only 정상 baseline을 바탕으로 격리 복사본 생성, watchdog_ms 갱신 누락을 주입한다.
valid PING으로 건강 상태를 잠깐 복원해도 다음 supervisor tick에서 stale timestamp 때문에 watchdog=0이다.
iteration 2: REQ-04와 실패 진단을 근거로 timestamp 갱신을 복원하고 동일 모델에서 정상 복구를 확인한다.

Build는 **제한된 소스 모델 검사**이며 C 컴파일이 아니다. 실행은 지정된 타임라인의 메모리 모델이다.
검토된 v1 baseline과 한 줄 결함 variant만 지원하며 baseline 변경 시 실패한다.
실제 socket/task, native binary, VxWorks/RTP 동작을 검증한 결과로 해석하지 않는다.

Context는 controller metadata, request, main.c 및 선택된 architecture/network/REQ-02~05 발췌,
실패 진단과 이전 iteration을 사용한다. 전체 문서나 repository를 검색하지 않는다.
Response는 기존 ProviderDecision/EditProposal에 analysis, targetFile, expectation을 붙인다.
main.c의 지정된 한 줄 수정만 허용한다. COMPLETE는 advisory이며 host 검증이 PASS를 결정한다.

workspace/artifacts/demo-run-<timestamp>-<random>/:

- result.json: status, iteration, model 표시, baseline hash/보존 여부, expected/actual, cleanup.
- diff.patch 및 iteration patch: 주입/복구된 줄만 기록. 미승인 제안은 iteration patch에서 확인.
- agent-context.json: 발췌·진단·이력, source 경로/hash만 기록. 전체 source 내용은 저장하지 않음.
- validation.log, build.log, runtime.log, iterations.json, permissions.json, 요약 plan/response.
- work/main.c: 실행에 필요한 격리 복사본. PASS/FAIL/Cancel 시 제거한다. baseline에는 쓰지 않는다.

일반 기존 loop의 evidence 정책은 유지하고, Demo에만 요약 evidence 옵션을 적용했다.
프로세스를 시작하지 않으므로 Cancel이 종료할 외부 PID는 없다. 다른 사용자의 프로세스를 건드리지 않는다.
이번 UI 검증은 Webview JS/command contract 수준이다. 실제 Development Host를 다시 띄우지는 않았다.

## 다음 Public LLM Work

~~~text
Read docs/DEMO_SCENARIO_USAGE.md and DemoAdapters/DemoProvider.
Use the same public Demo Controller, selected context, response boundary and AgentEditLoop.
Replace only deterministic judgement with an approved Public LLM adapter after confirming API/data scope.
No keys or endpoints may be guessed. Preserve baseline, permissions, exact edit scope and evidence.
Reuse existing SDK/QEMU PASS and run only changed adapter tests. No Full Validation or old regression.
Keep the Demo model result distinct from C compilation/VxWorks execution.
~~~
