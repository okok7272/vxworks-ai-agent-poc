import { EventEmitter } from 'node:events';
import { ApplicationBackend, ApplicationBuild, ApplicationRun, ApplicationWrite } from '../agent/loop/Types';
import { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { ConsoleBuffer } from './ConsoleBuffer';
import { WslRunner } from './WslRunner';
import { BackendState, ConsoleEvent, EnvironmentResult, ExecutionResult, ValidationResult, VxWorksBackend } from './VxWorksBackend';

export class SdkBackend extends EventEmitter implements ApplicationBackend {
  state: BackendState = { backend: 'sdk', sdk: 'Unknown', qemu: 'Stopped', vxworks: 'Stopped', debugger: 'Disconnected' };
  private readonly console = new ConsoleBuffer();
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private sequence = 0;
  private disposed = false;
  private cancelling?: Promise<void>;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly extensionPath: string, private readonly runner = new WslRunner()) { super(); }

  private append(event: ConsoleEvent): void { this.console.append(event.text); this.emit('console', event); }
  private failPending(error: Error): void {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }
  private async connect(): Promise<void> {
    if (this.disposed) { throw new Error('SDK backend is disposed'); }
    if (this.child) { return; }
    if (!this.starting) {
      this.starting = (async () => {
        const bridge = await this.runner.capture('/usr/bin/wslpath', ['-a', join(this.extensionPath, 'scripts', 'sdk_bridge.py').replace(/\\/g, '/')]);
        if (this.disposed) { throw new Error('SDK backend is disposed'); }
        const child = this.runner.spawn('/usr/bin/python3', ['-u', bridge]);
        this.child = child;
        const lines = createInterface({ input: child.stdout });
        lines.on('line', line => {
          try {
            const message = JSON.parse(line);
            if (message.event === 'console') { this.append(message.data); }
            else if (message.event === 'state') { this.state = message.data; this.emit('state', this.state); }
            else if (typeof message.id === 'number') {
              const entry = this.pending.get(message.id);
              if (!entry) { return; }
              this.pending.delete(message.id); clearTimeout(entry.timer);
              if (message.ok) { entry.resolve(message.result); }
              else { entry.reject(new Error(message.error)); }
            }
          } catch { this.append({ source: 'bridge', stream: 'stderr', text: line + '\n' }); }
        });
        child.stderr.setEncoding('utf8').on('data', text => this.append({ source: 'bridge', stream: 'stderr', text }));
        child.on('error', error => this.failPending(error));
        child.stdin.on('error', error => this.failPending(error));
        child.on('close', (code) => {
          this.child = undefined;
          this.failPending(new Error('WSL SDK bridge exited (' + code + '). See console.'));
          this.state = { ...this.state, qemu: 'Stopped', vxworks: 'Stopped', debugger: 'Disconnected',
            qemuPid: undefined, debuggerPid: undefined, ...(this.disposed ? {} : { sdk: 'Error', error: 'SDK bridge disconnected' }) };
          this.emit('state', this.state);
        });
      })().finally(() => { this.starting = undefined; });
    }
    await this.starting;
  }
  private async rpc<T>(operation: string, args: object = {}, timeoutMs = 120000): Promise<T> {
    await this.connect();
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // EOF asks the bridge to terminate its owned Linux process groups.
        this.child?.stdin.end();
        reject(new Error(operation + ' timed out; shutting down the SDK bridge. See console.'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ id, operation, args }) + '\n');
    });
  }
  async validateEnvironment(): Promise<EnvironmentResult> {
    try { return await this.rpc('validate'); }
    catch (error) {
      this.state = { ...this.state, sdk: 'Error', error: String(error) };
      this.emit('state', this.state); throw error;
    }
  }
  build(): Promise<ExecutionResult> { return this.rpc('build'); }
  clean(): Promise<ExecutionResult> { return this.rpc('clean'); }
  startQemu(): Promise<BackendState> { return this.rpc('startQemu'); }
  waitForBoot(): Promise<BackendState> { return this.rpc('waitForBoot'); }
  run(): Promise<ExecutionResult> { return this.rpc('run'); }
  runRtp(): Promise<ExecutionResult> { return this.run(); }
  stop(): Promise<BackendState> { return this.rpc('stop'); }
  stopQemu(): Promise<BackendState> { return this.stop(); }
  debugStart(): Promise<BackendState> { return this.rpc('debugStart'); }
  debugStop(): Promise<BackendState> { return this.rpc('debugStop'); }
  async getConsole(lastLines?: number): Promise<string> { return this.console.read(lastLines); }
  async clearConsole(): Promise<void> { this.console.clear(); this.emit('console', { source: 'clear', stream: 'stdout', text: '' }); }
  fullValidation(): Promise<ValidationResult> { return this.rpc('fullValidation', {}, 300000); }
  writeApplication(runId: string, source: string, previousHash: string): Promise<ApplicationWrite> {
    return this.rpc('writeApplication', { runId, source, previousHash });
  }
  buildApplication(runId: string): Promise<ApplicationBuild> { return this.rpc('buildApplication', { runId }); }
  runApplication(runId: string): Promise<ApplicationRun> { return this.rpc('runApplication', { runId }); }
  cancel(): Promise<void> {
    if (this.cancelling) { return this.cancelling; }
    this.disposed = true;
    this.cancelling = (async () => {
      await this.starting?.catch(() => undefined);
      const child = this.child;
      if (!child) { return; }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Owned SDK bridge cleanup did not finish within 30 seconds')), 30000);
        child.once('close', () => { clearTimeout(timer); resolve(); });
        // Out-of-band EOF interrupts a build/PTY wait; never enqueue cancellation.
        child.stdin.end();
      });
    })();
    return this.cancelling;
  }
  async dispose(): Promise<void> {
    if (this.disposed) { return; }
    if (this.child) {
      try { await this.rpc('shutdown', {}, 20000); }
      finally { this.child?.stdin.end(); this.disposed = true; }
    } else { this.disposed = true; }
    this.removeAllListeners();
  }
}
