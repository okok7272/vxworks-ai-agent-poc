import { createHash } from 'node:crypto';
import { MockBackend } from './MockBackend';
import { ApplicationBackend, ApplicationBuild, ApplicationRun, ApplicationWrite } from '../agent/loop/Types';
export class MockApplicationBackend extends MockBackend implements ApplicationBackend {
  source = '';
  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  async writeApplication(runId: string, source: string, previousHash: string): Promise<ApplicationWrite> {
    if (this.hash(this.source) !== previousHash) { throw new Error('Source conflict'); }
    const previousSource = this.source; this.source = source;
    return { path: 'mock://' + runId + '/main.c', previousSource, sourceHash: this.hash(source), buildCommand: ['MOCK', 'wr-cc', '-rtp', 'main.c'] };
  }
  async buildApplication(): Promise<ApplicationBuild> {
    const failed = /[“”]/.test(this.source);
    return { command: ['MOCK', 'wr-cc', '-rtp', 'main.c'], stdout: '', stderr: failed ? 'main.c:4:12: error: invalid character in source' : '', exitCode: failed ? 1 : 0, outputFile: failed ? undefined : 'mock://app.vxe' };
  }
  async runApplication(): Promise<ApplicationRun> {
    await this.startQemu(); await this.debugStart();
    const literal = this.source.match(/printf\(("(?:\\.|[^"\\])*")\)/)?.[1];
    const actualOutput: string = literal ? JSON.parse(literal) : '';
    this.emit('console', { source: 'wrdbg', stream: 'pty', text: actualOutput });
    return { stdout: actualOutput, stderr: '', exitCode: 0, actualOutput, completed: true, simulated: true };
  }
  async cancel(): Promise<void> { await this.dispose(); }
}
