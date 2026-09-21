import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentProvider } from '../agent/AgentProvider';
import type { ProviderContext, ProviderDecision } from '../agent/ProviderContract';
import { CompanyAgentProvider, COMPANY_PROVIDER_UNAVAILABLE } from '../agent/CompanyAgentProvider';
import { RuleBasedAgentProvider } from '../agent/RuleBasedAgentProvider';

const context: ProviderContext = {
  request: { text: 'Print Hello Agent' }, sources: [{ relativePath: 'main.c', content: 'source', hash: 'snapshot-hash' }],
  compiler: { stdout: '', stderr: 'error: missing semicolon', exitCode: 1 },
  runtime: { console: 'Unexpected Agent', actualOutput: 'Unexpected Agent', completed: true },
  history: [{ number: 1, reason: 'fixture', sourceHash: 'snapshot-hash', diff: 'diff', validation: { passed: false, reason: 'mismatch' } }]
};
test('legacy deterministic provider satisfies extended contract without optional methods', async () => {
  const provider: AgentProvider = new RuleBasedAgentProvider();
  assert.equal(provider.propose, undefined); assert.equal(provider.capabilities, undefined);
  const plan = await provider.analyze(context.request, new AbortController().signal);
  assert.equal(plan.expectedOutput, 'Hello Agent'); assert.match(plan.source, /printf\(“/);
});
test('planning contract carries context and typed edit/assessment without executing tools', async () => {
  const legacy = new RuleBasedAgentProvider();
  const provider: AgentProvider = {
    id: 'contract-only', analyze: legacy.analyze.bind(legacy), repair: legacy.repair.bind(legacy),
    propose: async data => {
      assert.equal(data.compiler?.exitCode, 1); assert.equal(data.runtime?.console, 'Unexpected Agent');
      assert.equal(data.history[0].validation?.passed, false); assert.equal(data.sources[0].relativePath, 'main.c');
      return { action: { kind: 'EDIT', proposal: { source: 'corrected', reason: 'diagnostic' } },
        assessment: { status: 'UNKNOWN', reason: 'Host must build and validate', evidenceIds: ['iteration-1'] } };
    }
  };
  const decision: ProviderDecision = await provider.propose!(context, new AbortController().signal);
  assert.equal(decision.action.kind, 'EDIT'); assert.equal(decision.assessment?.status, 'UNKNOWN');
});
test('company placeholder fails closed and reports unknown capabilities', async () => {
  const provider = new CompanyAgentProvider(); const signal = new AbortController().signal;
  assert.ok(Object.values(provider.capabilities).every(value => value === 'unknown'));
  await assert.rejects(provider.analyze(context.request, signal), { message: COMPANY_PROVIDER_UNAVAILABLE });
  await assert.rejects(provider.repair({ source: '', expectedOutput: '', kind: 'compile', diagnostic: '', actualOutput: '', iteration: 1 }, signal), { message: COMPANY_PROVIDER_UNAVAILABLE });
  assert.deepEqual(await provider.propose(context, signal), { action: { kind: 'ABORT', reason: COMPANY_PROVIDER_UNAVAILABLE } });
});
test('company placeholder honors cancellation before producing a decision', async () => {
  const provider = new CompanyAgentProvider(); const abort = new AbortController(); abort.abort('contract cancelled');
  await assert.rejects(provider.propose(context, abort.signal), /contract cancelled/);
  await assert.rejects(provider.analyze(context.request, abort.signal), /contract cancelled/);
});
