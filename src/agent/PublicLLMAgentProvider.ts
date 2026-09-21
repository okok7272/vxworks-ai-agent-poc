import type { AgentProvider } from './AgentProvider';
import type { LoopRequest, Plan, RepairContext, EditProposal } from './loop/Types';
import { abortable, checkAbort } from './loop/Abort';
import { DemoContext, EXPECTED, digest } from '../demo/DemoAdapters';
import type { LLMTransport } from './llm/LLMTransport';
import { ProviderResponseError, serializeDemoContext, validateLLMResponse } from './llm/PublicLLMContract';

export const PUBLIC_LLM_NOT_CONFIGURED = 'Public LLM: NOT CONFIGURED (no API transport is installed)';
/** Judgement only. The host supplies selected public context; no file/backend handles. */
export class PublicLLMAgentProvider implements AgentProvider {
  readonly id = 'public-llm-demo-v1';
  readonly capabilities = { structuredOutput: 'supported', toolCalling: 'unsupported' } as const;
  private context: DemoContext;
  constructor(context: DemoContext, private readonly transport?: LLMTransport, private readonly timeoutMs = 15000) {
    this.context = JSON.parse(JSON.stringify(context));
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) { throw new Error('Invalid provider timeout'); }
  }
  private async edit(context: DemoContext, signal: AbortSignal): Promise<{ edit: EditProposal; analysis: string }> {
    checkAbort(signal);
    if (!this.transport) { throw new ProviderResponseError(PUBLIC_LLM_NOT_CONFIGURED); }
    const serialized = serializeDemoContext(context);
    const abort = new AbortController(); const cancel = () => abort.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) { cancel(); }
    const timer = setTimeout(() => abort.abort('LLM transport timeout'), this.timeoutMs);
    try {
      checkAbort(abort.signal);
      const raw = await abortable(this.transport.send(serialized, abort.signal), abort.signal);
      checkAbort(abort.signal);
      const response = validateLLMResponse(raw, context.sources[0].content);
      const action = response.decision.action;
      if (action.kind === 'ABORT') { throw new ProviderResponseError('Provider ABORT: ' + action.reason); }
      if (action.kind !== 'EDIT') { throw new ProviderResponseError('COMPLETE cannot bypass host edit/build/validation'); }
      this.context = context;
      return { edit: action.proposal, analysis: response.analysis };
    } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
  }
  async analyze(request: Readonly<LoopRequest>, signal: AbortSignal): Promise<Plan> {
    const { edit, analysis } = await this.edit({ ...this.context, request: { text: request.text } }, signal);
    return { ...edit, analysis, expectedOutput: EXPECTED };
  }
  async repair(input: Readonly<RepairContext>, signal: AbortSignal): Promise<EditProposal> {
    const context: DemoContext = { ...this.context, sources: [{ relativePath: 'main.c', content: input.source, hash: digest(input.source) }],
      compiler: input.kind === 'compile' ? { stdout: '', stderr: input.diagnostic, exitCode: null } : this.context.compiler,
      runtime: input.kind === 'runtime' ? { console: input.diagnostic, actualOutput: input.actualOutput, completed: false } : this.context.runtime,
      history: [...this.context.history, { number: input.iteration, reason: input.kind + ' repair', sourceHash: digest(input.source), diff: '', validation: { passed: false, reason: input.diagnostic } }] };
    return (await this.edit(context, signal)).edit;
  }
}
