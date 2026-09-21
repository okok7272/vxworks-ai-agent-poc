import { EventEmitter } from 'node:events';
import { writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentEditLoop } from '../agent/loop/AgentEditLoop';
import { PermissionManager } from '../permissions/PermissionManager';
import { DemoBackend } from './DemoBackend';
import { DemoProvider } from './DemoProvider';
import { DEMO, EXPECTED, digest, readDemo } from './DemoAdapters';
export const DEMO_COMMANDS = { demoRun: 'runDemoScenario', demoCancel: 'cancelDemoScenario', demoDiff: 'showDemoDiff', demoEvidence: 'showDemoEvidence' } as const;
export class DemoRunner extends EventEmitter {
  view = { controller: DEMO.title, agent: DEMO.agent, backend: 'Demo/Mock (model only)', scenario: DEMO.scenario,
    status: 'IDLE', active: false, iteration: 0, build: 'Not run', validation: 'Not run', expected: EXPECTED, actual: '', evidenceDirectory: '', error: '' };
  private loop?: AgentEditLoop;
  private work?: Promise<unknown>;
  constructor(private readonly root: string, private readonly project: string, private readonly permissions: PermissionManager) { super(); }
  async cancel(): Promise<void> { await this.loop?.cancel(); await this.work; }
  start(): Promise<unknown> {
    if (this.view.active) { return Promise.reject(new Error('Demo scenario is active')); }
    this.view.active = true; this.view.status = 'PREPARING'; this.emit('state', this.view);
    this.work = this.execute(); return this.work;
  }
  private async execute() {
    try {
      const baseline = readDemo(this.root, 'src/main.c'); const baselineHash = digest(baseline);
      const provider = new DemoProvider(this.root, baseline);
      this.loop = new AgentEditLoop(this.project, provider, this.permissions, () => new DemoBackend(this.project, baseline),
        { iterations: 2, runtimeFixes: 1, compileFixes: 0 }, { prefix: 'demo-run', baseline, summariesOnly: true,
          runDescription: 'Run a local Demo model only, then release its isolated copy. No SDK/QEMU/wrdbg/target process is started.' });
      this.loop.on('state', state => {
        this.view.status = state.status === 'FIXING' ? 'ANALYZING' : state.status === 'RUNNING' ? 'VALIDATING' : state.status;
        this.view.iteration = state.iteration;
        this.view.evidenceDirectory = state.evidenceDirectory ?? '';
        this.view.build = state.buildResult ? (state.buildResult.exitCode === 0 ? 'PASS (model check)' : 'FAIL') : 'Not run';
        this.emit('state', this.view);
      });
      this.loop.on('console', event => {
        if (this.view.evidenceDirectory) { appendFileSync(join(this.view.evidenceDirectory, 'validation.log'), event.text); }
      });
      const result = await this.loop.start({ text: 'Find and fix watchdog recovery after UDP timeout in the isolated Demo Controller.' });
      const baselineUnchanged = digest(readDemo(this.root, 'src/main.c')) === baselineHash;
      if (!baselineUnchanged) { result.status = 'FAIL'; result.failureReason = 'Baseline changed during scenario'; }
      const evidence = { ...result, controller: DEMO.id, scenario: DEMO.scenario, simulated: true, buildKind: 'restricted-source-model; no C compiler', baselineUnchanged,
        baselineHash, requestedAction: result.status === 'PASS' ? 'COMPLETE' : 'ABORT' };
      writeFileSync(join(result.evidenceDirectory, 'result.json'), JSON.stringify(evidence, null, 2));
      writeFileSync(join(result.evidenceDirectory, 'agent-context.json'), JSON.stringify(provider.contexts.map(c => ({ ...c,
        sources: c.sources.map(({ relativePath, hash }) => ({ relativePath, hash })) })), null, 2));
      writeFileSync(join(result.evidenceDirectory, 'responses.json'), JSON.stringify(provider.responses.map(r => ({ ...r,
        decision: { action: { kind: r.decision.action.kind }, assessment: r.decision.assessment } })), null, 2));
      appendFileSync(join(result.evidenceDirectory, 'validation.log'), 'Result: ' + result.status + '; baselineUnchanged=' + baselineUnchanged + '\n');
      Object.assign(this.view, { status: result.status, validation: result.status === 'PASS' ? 'PASS' : result.status,
        actual: result.actualOutput, error: result.failureReason ?? '' });
      return evidence;
    } catch (error) { this.view.status = 'FAIL'; this.view.error = String(error); throw error; }
    finally { this.view.active = false; this.emit('state', this.view); }
  }
}
