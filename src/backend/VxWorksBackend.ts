export type Action = 'validateEnvironment' | 'build' | 'clean' | 'startQemu' |
  'run' | 'stop' | 'debugStart' | 'debugStop' | 'getConsole' | 'clearConsole' | 'fullValidation';
export type BackendState = {
  backend: 'mock' | 'sdk';
  sdk: 'Unknown' | 'Ready' | 'Error';
  qemu: 'Stopped' | 'Running';
  vxworks: 'Stopped' | 'Booting' | 'Ready';
  debugger: 'Disconnected' | 'Connecting' | 'Connected';
  buildPid?: number;
  qemuPid?: number;
  debuggerPid?: number;
  error?: string;
};
export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  outputFile?: string;
}
export interface EnvironmentCheck { name: string; ok: boolean; detail: string }
export interface EnvironmentResult { ready: boolean; checks: EnvironmentCheck[] }
export interface ValidationResult extends ExecutionResult {
  resultPath?: string;
  result?: { status: string; checks: Array<{ name: string; passed: boolean }>; error?: string };
}
export interface ConsoleEvent { source: string; stream: string; text: string }
export interface VxWorksBackend {
  readonly state: BackendState;
  on(event: 'state', listener: (state: BackendState) => void): this;
  on(event: 'console', listener: (event: ConsoleEvent) => void): this;
  removeAllListeners(): this;
  validateEnvironment(): Promise<EnvironmentResult>;
  build(): Promise<ExecutionResult>;
  clean(): Promise<ExecutionResult>;
  startQemu(): Promise<BackendState>;
  run(): Promise<ExecutionResult>;
  stop(): Promise<BackendState>;
  debugStart(): Promise<BackendState>;
  debugStop(): Promise<BackendState>;
  getConsole(lastLines?: number): Promise<string>;
  clearConsole(): Promise<void>;
  fullValidation(): Promise<ValidationResult>;
  dispose(): Promise<void>;
}
