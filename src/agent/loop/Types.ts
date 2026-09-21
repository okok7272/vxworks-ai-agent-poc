import { BackendState, ExecutionResult, VxWorksBackend } from '../../backend/VxWorksBackend';

export type LoopStatus = 'IDLE' | 'ANALYZING' | 'EDITING' | 'BUILDING' | 'FIXING' |
  'RUNNING' | 'VALIDATING' | 'PASS' | 'FAIL' | 'CANCELLED';
export type Scenario = 'compile' | 'runtime' | 'combined';
export interface LoopRequest { text: string; expectedOutput?: string; scenario?: Scenario }
export interface Plan { source: string; reason: string; analysis: string; expectedOutput: string }
export interface RepairContext {
  source: string; expectedOutput: string; kind: 'compile' | 'runtime';
  diagnostic: string; actualOutput: string; iteration: number;
}
export interface EditProposal { source: string; reason: string }
export interface ApplicationWrite {
  path: string; previousSource: string; sourceHash: string; buildCommand: string[];
}
export interface ApplicationBuild extends ExecutionResult { command: string[] }
export interface ApplicationRun extends ExecutionResult {
  actualOutput: string; completed: boolean; simulated?: boolean;
}
export interface ApplicationBackend extends VxWorksBackend {
  writeApplication(runId: string, source: string, previousHash: string): Promise<ApplicationWrite>;
  buildApplication(runId: string): Promise<ApplicationBuild>;
  runApplication(runId: string): Promise<ApplicationRun>;
  cancel(): Promise<void>;
}
export interface Iteration {
  number: number; reason: string; sourceHash: string; beforeHash: string;
  sourcePath?: string; applied: boolean; diff: string;
  buildCommand: string[]; build: ApplicationBuild | null;
  runtime: ApplicationRun | null; runtimeConsole: string;
  backendStates: BackendState[];
  validation: { passed: boolean; reason: string } | null;
}
export interface LoopResult {
  status: 'PASS' | 'FAIL' | 'CANCELLED'; iterationCount: number; buildAttempts: number;
  runtimeAttempts: number; compileFixes: number; runtimeFixes: number;
  changedFiles: string[]; expectedOutput: string; actualOutput: string; failureReason: string | null;
  evidenceDirectory: string; runId: string; provider: string; backend: 'mock' | 'sdk';
  cleanup: 'pending' | 'complete' | 'failed'; cleanupError?: string;
}
export interface LoopView {
  status: LoopStatus; active: boolean; iteration: number; lastError: string | null;
  buildResult: ApplicationBuild | null; runtimeResult: ApplicationRun | null;
  backendState?: BackendState; evidenceDirectory?: string;
}
export interface LoopLimits { compileFixes: number; runtimeFixes: number; iterations: number; timeoutMs: number }
export const DEFAULT_LIMITS: LoopLimits = { compileFixes: 3, runtimeFixes: 2, iterations: 5, timeoutMs: 300000 };
