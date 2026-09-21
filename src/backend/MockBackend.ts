import { EventEmitter } from 'node:events';
import { ConsoleBuffer } from './ConsoleBuffer';
import { BackendState, EnvironmentResult, ExecutionResult, ValidationResult, VxWorksBackend } from './VxWorksBackend';

export class MockBackend extends EventEmitter implements VxWorksBackend {
  state: BackendState = { backend: 'mock', sdk: 'Ready', qemu: 'Stopped', vxworks: 'Stopped', debugger: 'Disconnected' };
  private console = new ConsoleBuffer();
  private update(values: Partial<BackendState>): BackendState { Object.assign(this.state, values); this.emit('state', this.state); return this.state; }
  async validateEnvironment(): Promise<EnvironmentResult> { return { ready: true, checks: [{ name: 'mock', ok: true, detail: 'Simulation only; no WSL commands executed.' }] }; }
  async build(): Promise<ExecutionResult> { return { stdout: '[MOCK] Built helloworld.vxe', stderr: '', exitCode: 0, outputFile: 'mock://helloworld.vxe' }; }
  async clean(): Promise<ExecutionResult> { return { stdout: '[MOCK] Cleaned', stderr: '', exitCode: 0 }; }
  async startQemu(): Promise<BackendState> { return this.update({ qemu: 'Running', vxworks: 'Ready' }); }
  async run(): Promise<ExecutionResult> {
    await this.startQemu(); await this.debugStart();
    const text = '[MOCK] Hello World\n'; this.console.append(text);
    this.emit('console', { source: 'mock', stream: 'stdout', text });
    return { stdout: text, stderr: '', exitCode: 0 };
  }
  async stop(): Promise<BackendState> { return this.update({ qemu: 'Stopped', vxworks: 'Stopped', debugger: 'Disconnected' }); }
  async debugStart(): Promise<BackendState> {
    if (this.state.qemu !== 'Running') { throw new Error('Start QEMU first (requires target_run permission).'); }
    return this.update({ debugger: 'Connected' });
  }
  async debugStop(): Promise<BackendState> { return this.update({ debugger: 'Disconnected' }); }
  async getConsole(lastLines?: number): Promise<string> { return this.console.read(lastLines); }
  async clearConsole(): Promise<void> { this.console.clear(); this.emit('console', { source: 'clear', stream: 'stdout', text: '' }); }
  async fullValidation(): Promise<ValidationResult> { return { stdout: '[MOCK] Validation only', stderr: '', exitCode: 0, result: { status: 'MOCK', checks: [] } }; }
  async dispose(): Promise<void> { await this.stop(); this.removeAllListeners(); }
}
