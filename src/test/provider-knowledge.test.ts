import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProviderContext } from '../agent/ProviderContract';
import { CompanyAgentProvider } from '../agent/CompanyAgentProvider';
test('optional knowledge preserves provenance and controller scope without enabling execution', async () => {
  const context: ProviderContext = { request: { text: 'Review recovery' }, sources: [], history: [],
    knowledge: [{ id: 'demo-requirements', title: 'Demo requirements', source: 'repository', version: '1',
      controller: 'demo-controller', documentType: 'controller', confidence: 'VERIFIED', content: 'REQ-03 recovery' }] };
  const result = await new CompanyAgentProvider().propose(context, new AbortController().signal);
  assert.equal(result.action.kind, 'ABORT');
  assert.equal(context.knowledge?.[0].controller, 'demo-controller');
  assert.equal(context.knowledge?.[0].confidence, 'VERIFIED');
  const withoutKnowledge: ProviderContext = { request: context.request, sources: [], history: [] };
  assert.equal(withoutKnowledge.knowledge, undefined);
});
