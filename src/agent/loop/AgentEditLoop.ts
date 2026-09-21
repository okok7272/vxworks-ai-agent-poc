import { EventEmitter } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentProvider } from '../AgentProvider';
import { PermissionManager } from '../../permissions/PermissionManager';
import { abortable, checkAbort } from './Abort';
import { EvidenceOptions, compactDiff } from './EvidenceOptions';
import { ApplicationBackend, DEFAULT_LIMITS, EditProposal, Iteration, LoopLimits, LoopRequest, LoopResult, LoopStatus, LoopView } from './Types';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export class AgentEditLoop extends EventEmitter {
  view: LoopView = { status: 'IDLE', active: false, iteration: 0, lastError: null, buildResult: null, runtimeResult: null };
  private abort?: AbortController;
  private backend?: ApplicationBackend;
  private work?: Promise<LoopResult>;
  private cancellation?: Promise<void>;
  private timedOut = false;
  private readonly limits: LoopLimits;
  constructor(private readonly project: string, private readonly provider: AgentProvider,
    private readonly permissions: PermissionManager, private readonly factory: () => ApplicationBackend,
    limits: Partial<LoopLimits> = {}, private readonly evidence: EvidenceOptions = {}) {
    super(); this.limits = { ...DEFAULT_LIMITS, ...limits };
    for (const key of Object.keys(DEFAULT_LIMITS) as (keyof LoopLimits)[]) {
      if (!Number.isInteger(this.limits[key]) || this.limits[key] < (key.endsWith('Fixes') ? 0 : 1) || this.limits[key] > DEFAULT_LIMITS[key]) {
        throw new Error('Invalid loop limit: ' + key);
      }
    }
  }
  private update(status: LoopStatus) { this.view.status = status; this.emit('state', { ...this.view }); }
  start(request: LoopRequest): Promise<LoopResult> {
    if (this.view.active) { return Promise.reject(new Error('Agent Loop is already active')); }
    this.abort = new AbortController(); this.cancellation = undefined; this.timedOut = false;
    this.view = { status: 'ANALYZING', active: true, iteration: 0, lastError: null, buildResult: null, runtimeResult: null };
    this.work = this.execute(request); return this.work;
  }
  async cancel(): Promise<void> {
    if (!this.view.active) { return; }
    this.abort!.abort('Cancelled by user');
    if (!this.cancellation) { this.cancellation = this.backend?.cancel() ?? Promise.resolve(); }
    // Observe cleanup rejection immediately, while execute records it in result.json.
    await this.cancellation.catch(() => undefined);
    await this.work;
  }
  private async execute(request: LoopRequest): Promise<LoopResult> {
    const runId = (this.evidence.prefix ?? 'agent-loop') + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(4).toString('hex');
    const directory = join(this.project, 'artifacts', runId);
    const signal = this.abort!.signal;
    const iterations: Iteration[] = [];
    let current: Iteration | undefined;
    let source = '', previousHash = hash('');
    const result: LoopResult = { status: 'FAIL', iterationCount: 0, buildAttempts: 0, runtimeAttempts: 0, compileFixes: 0, runtimeFixes: 0,
      changedFiles: [], expectedOutput: '', actualOutput: '', failureReason: null, evidenceDirectory: directory,
      runId, provider: this.provider.id, backend: 'mock', cleanup: 'pending' };
    const save = () => {
      writeFileSync(join(directory, 'iterations.json'), JSON.stringify(iterations, null, 2));
      writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2));
      writeFileSync(join(directory, 'permissions.json'), JSON.stringify(this.permissions.audit.filter(a => a.description?.includes(runId)), null, 2));
    };
    const timeout = setTimeout(() => { this.timedOut = true; void this.cancel(); }, this.limits.timeoutMs);
    try {
      mkdirSync(directory, { recursive: true });
      for (const name of ['diff.patch', 'build.log', 'runtime.log']) { writeFileSync(join(directory, name), ''); }
      this.view.evidenceDirectory = directory;
      this.backend = this.factory(); result.backend = this.backend.state.backend;
      this.backend.on('state', state => { this.view.backendState = { ...state }; current?.backendStates.push({ ...state }); this.update(this.view.status); });
      this.backend.on('console', event => {
        const build = event.source === 'agent-build';
        appendFileSync(join(directory, build ? 'build.log' : 'runtime.log'), event.text);
        if (current) {
          if (build && current.build) { if (event.stream === 'stderr') { current.build.stderr += event.text; } else { current.build.stdout += event.text; } }
          else { current.runtimeConsole += event.text; }
        }
        this.emit('console', event);
      });
      this.update('ANALYZING');
      const plan = await abortable(this.provider.analyze(request, signal), signal);
      result.expectedOutput = plan.expectedOutput;
      writeFileSync(join(directory, 'plan.json'), JSON.stringify({ request, plan: this.evidence.summariesOnly ?
        { analysis: plan.analysis, reason: plan.reason, expectedOutput: plan.expectedOutput, sourceHash: hash(plan.source) } : plan }, null, 2)); save();
      let proposal: EditProposal = plan;
      const failures = new Set<string>();
      for (let number = 1; number <= this.limits.iterations; number++) {
        checkAbort(signal); result.iterationCount = number; this.view.iteration = number;
        if (proposal.source === source) { throw new Error('Provider made no source change'); }
        const diff = this.evidence.summariesOnly ? compactDiff(source || this.evidence.baseline || '', proposal.source) : '--- a/main.c\n+++ b/main.c\n@@ -1,' + (source ? source.trimEnd().split('\n').length : 0) + ' +1,' + proposal.source.trimEnd().split('\n').length + ' @@\n' +
          (source ? source.trimEnd().split('\n').map(line => '-' + line).join('\n') + '\n' : '') + proposal.source.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n';
        current = { number, reason: proposal.reason, sourceHash: hash(proposal.source), beforeHash: previousHash, applied: false, diff,
          buildCommand: [], build: null, runtime: null, runtimeConsole: '', backendStates: [{ ...this.backend.state }], validation: null };
        iterations.push(current);
        if (!this.evidence.summariesOnly) {
          writeFileSync(join(directory, 'iteration-' + number + '-before.c'), source);
          writeFileSync(join(directory, 'iteration-' + number + '-after.c'), proposal.source);
        }
        writeFileSync(join(directory, 'iteration-' + number + '.patch'), diff);
        this.update('EDITING'); save();
        await this.permissions.authorize('write_file', { signal, description: runId + ': main.c; ' + proposal.reason + '\nReview: ' + join(directory, 'iteration-' + number + '.patch') });
        checkAbort(signal);
        const receipt = await this.backend.writeApplication(runId, proposal.source, previousHash);
        if (receipt.previousSource !== source || receipt.sourceHash !== current.sourceHash) { throw new Error('Application write receipt mismatch'); }
        source = proposal.source; previousHash = receipt.sourceHash;
        current.applied = true; current.sourcePath = receipt.path; current.buildCommand = receipt.buildCommand;
        if (!result.changedFiles.includes(receipt.path)) { result.changedFiles.push(receipt.path); }
        appendFileSync(join(directory, 'diff.patch'), '# iteration ' + number + '\n' + diff); save();
        checkAbort(signal); await this.permissions.authorize('build', { signal, description: runId });
        this.update('BUILDING'); result.buildAttempts++;
        current.build = { command: receipt.buildCommand, stdout: '', stderr: '', exitCode: null };
        appendFileSync(join(directory, 'build.log'), '\n' + JSON.stringify(receipt.buildCommand) + '\n');
        current.build = await this.backend.buildApplication(runId); this.view.buildResult = current.build; save(); checkAbort(signal);
        let kind: 'compile' | 'runtime' = 'compile';
        let diagnostic = current.build.stdout + current.build.stderr;
        if (current.build.exitCode === 0) {
          await this.permissions.authorize('agent_loop_run', { signal, description: runId + ': ' + (this.evidence.runDescription ?? 'run this private RTP and clean up only this loop’s QEMU/debugger afterward.') });
          checkAbort(signal); this.update('RUNNING'); result.runtimeAttempts++;
          await this.permissions.authorize('debugStart', { signal, description: runId });
          current.runtime = await this.backend.runApplication(runId); this.view.runtimeResult = current.runtime;
          result.actualOutput = current.runtime.actualOutput;
          checkAbort(signal); this.update('VALIDATING');
          const passed = current.runtime.completed && result.actualOutput.trim() === result.expectedOutput.trim();
          current.validation = { passed, reason: passed ? 'Expected output matched and RTP exited' : 'Runtime output mismatch or RTP did not exit' };
          save();
          if (passed) { result.status = 'PASS'; break; }
          kind = 'runtime'; diagnostic = current.validation.reason + ': ' + JSON.stringify(result.actualOutput);
        } else { current.validation = { passed: false, reason: 'Compiler exited ' + current.build.exitCode }; }
        this.view.lastError = diagnostic; save();
        const fingerprint = kind + ':' + (kind === 'compile' ? diagnostic.split('\n').filter(l => /error:/.test(l)).join('\n').replace(/[^\s:]+\.c:\d+:\d+/g, 'main.c:LINE') || diagnostic : result.actualOutput.trim());
        if (failures.has(fingerprint)) { throw new Error('Repeated identical ' + kind + ' error; automatic repair stopped'); }
        failures.add(fingerprint);
        if (number === this.limits.iterations) { throw new Error('Total iteration limit reached'); }
        const counter = kind === 'compile' ? 'compileFixes' : 'runtimeFixes';
        if (result[counter] >= this.limits[counter]) { throw new Error(kind + ' fix limit reached'); }
        result[counter]++; this.update('FIXING');
        proposal = await abortable(this.provider.repair({ source, expectedOutput: result.expectedOutput, kind, diagnostic, actualOutput: result.actualOutput, iteration: number }, signal), signal);
      }
    } catch (error) {
      result.status = signal.aborted && !this.timedOut ? 'CANCELLED' : 'FAIL';
      result.failureReason = this.timedOut ? 'Overall loop timeout' : errorText(error);
      this.view.lastError = result.failureReason;
      if (current && !current.validation) { current.validation = { passed: false, reason: result.failureReason }; }
    } finally {
      clearTimeout(timeout);
      try {
        if (this.cancellation) { await this.cancellation; } else { await this.backend?.cancel(); }
        result.cleanup = 'complete';
      } catch (error) { result.cleanup = 'failed'; result.cleanupError = errorText(error); result.status = 'FAIL'; result.failureReason = 'Owned process cleanup failed: ' + result.cleanupError; }
      this.backend?.removeAllListeners(); this.backend = undefined;
      this.view.active = false;
      try { save(); } finally { this.update(result.status); }
    }
    return result;
  }
}
