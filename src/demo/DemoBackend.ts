import { mkdirSync, writeFileSync, readFileSync, unlinkSync, rmdirSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MockApplicationBackend } from '../backend/MockApplicationBackend';
import type { ApplicationBuild, ApplicationRun, ApplicationWrite } from '../agent/loop/Types';
import { EXPECTED, digest, seedDefect } from './DemoAdapters';

/** Deliberately restricted model, not a C compiler/interpreter or native executable. */
export class DemoBackend extends MockApplicationBackend {
  private file?: string;
  private builtHash?: string;
  constructor(private readonly project: string, private readonly baseline: string) {
    super();
    if (digest(baseline) !== '984aa81f922b86abdf70a9956354e4fe945946036575b7797d2fc5bcf70a82e0') {
      throw new Error('Demo model supports only the reviewed v1 baseline; update model tests before changing the fixture');
    }
  }
  override async writeApplication(runId: string, source: string, previousHash: string): Promise<ApplicationWrite> {
    if (!/^demo-run-[0-9TZa-f-]+$/.test(runId)) { throw new Error('Invalid Demo run'); }
    if (this.file && digest(readFileSync(this.file, 'utf8')) !== previousHash) { throw new Error('Isolated source changed externally'); }
    const folder = join(this.project, 'artifacts', runId, 'work');
    if (!this.file) {
      mkdirSync(folder);
      if (relative(realpathSync(this.project), realpathSync(folder)).startsWith('..')) { throw new Error('Demo workspace escaped project'); }
      this.file = join(folder, 'main.c');
    }
    const receipt = await super.writeApplication(runId, source, previousHash);
    writeFileSync(this.file, source, 'utf8'); this.builtHash = undefined;
    return { ...receipt, path: this.file, buildCommand: ['demo-model-check', 'main.c'] };
  }
  override async buildApplication(): Promise<ApplicationBuild> {
    const valid = this.source === this.baseline || this.source === seedDefect(this.baseline);
    this.builtHash = valid ? digest(this.source) : undefined;
    const text = valid ? 'PASS: supported Demo source model (no C compilation)\n' : 'error: unsupported Demo source; refusing to simulate\n';
    this.emit('console', { source: 'agent-build', stream: valid ? 'stdout' : 'stderr', text });
    return { command: ['demo-model-check', 'main.c'], stdout: valid ? text : '', stderr: valid ? '' : text, exitCode: valid ? 0 : 1 };
  }
  override async runApplication(): Promise<ApplicationRun> {
    if (!this.file || this.builtHash !== digest(readFileSync(this.file, 'utf8'))) { throw new Error('Demo model requires unchanged successful build'); }
    const repaired = this.source === this.baseline;
    // Independent host expectation: refresh at 1700, then supervisor samples at 1701.
    const state = { fault: 1, watchdog: 0, lastRx: 100, watchdogAt: repaired ? 100 : 0 };
    state.lastRx = 1700; state.fault = 0; state.watchdog = 1;
    if (repaired) { state.watchdogAt = 1700; }
    state.fault = Number(1701 - state.lastRx >= 1000);
    state.watchdog = Number(1701 - state.watchdogAt < 1500);
    const passed = state.fault === 0 && state.watchdog === 1;
    const actualOutput = passed ? EXPECTED : 'recovery failed: communication_fault=0 watchdog=0';
    const stdout = '[Demo model] timeout fault=1 watchdog=0\n[Demo model] ' + actualOutput + '\n';
    this.emit('console', { source: 'demo', stream: 'stdout', text: stdout });
    return { stdout, stderr: '', exitCode: 0, completed: true, simulated: true, actualOutput };
  }
  override async cancel(): Promise<void> {
    if (this.file) {
      unlinkSync(this.file); rmdirSync(join(this.file, '..')); this.file = undefined;
    }
    await super.cancel();
  }
}
