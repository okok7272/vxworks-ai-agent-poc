import type { AgentProvider } from '../agent/AgentProvider';
import type { LoopRequest, Plan, RepairContext, EditProposal } from '../agent/loop/Types';
import { checkAbort } from '../agent/loop/Abort';
import { DemoContext, DemoResponse, EXPECTED, DEFECT, FIX, demoContext, adaptResponse, seedDefect } from './DemoAdapters';
export class DemoProvider implements AgentProvider {
  readonly id = 'deterministic-demo-v1';
  contexts: DemoContext[] = [];
  responses: DemoResponse[] = [];
  constructor(private readonly root: string, private readonly baseline: string) {}
  async analyze(request: LoopRequest, signal: AbortSignal): Promise<Plan> {
    checkAbort(signal);
    const source = seedDefect(this.baseline);
    this.contexts.push(demoContext(this.root, source, request.text));
    return { source, expectedOutput: EXPECTED, analysis: 'REQ-04 requires recovery after valid PING; first demonstrate a missing watchdog timestamp update in an isolated copy.', reason: 'Create isolated defective copy; baseline remains read-only' };
  }
  async repair(input: RepairContext, signal: AbortSignal): Promise<EditProposal> {
    checkAbort(signal);
    if (input.kind !== 'runtime' || !input.actualOutput.includes('watchdog=0')) { throw new Error('Unexpected Demo diagnostic'); }
    const previous = this.contexts.at(-1)!;
    const context = demoContext(this.root, input.source, previous.request.text, previous);
    const enriched: DemoContext = { ...context,
      compiler: { stdout: 'Demo model accepted', stderr: '', exitCode: 0 },
      runtime: { console: input.diagnostic, actualOutput: input.actualOutput, completed: true },
      history: [...previous.history, { number: input.iteration, reason: 'Model recovery failed', sourceHash: context.sources[0].hash, diff: '', validation: { passed: false, reason: input.diagnostic } }] };
    this.contexts.push(enriched);
    if (!enriched.knowledge?.some(k => k.content.includes('REQ-04'))) { throw new Error('Recovery requirement unavailable'); }
    const response: DemoResponse = { analysis: 'watchdog_ms remains stale after PING; supervisor_tick makes watchdog unhealthy again. Restore timestamp per REQ-04.',
      targetFile: 'main.c', expectation: EXPECTED,
      decision: { action: { kind: 'EDIT', proposal: { source: input.source.replace(DEFECT, FIX), reason: 'Refresh watchdog timestamp on valid UDP recovery' } } } };
    this.responses.push(response);
    const edit = adaptResponse(response, input.source);
    if (edit === 'COMPLETE') { throw new Error('Expected an edit before validation'); }
    return edit;
  }
}
