import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { PublicLLMAgentProvider } from '../agent/PublicLLMAgentProvider';
import { MockLLMTransport } from '../agent/llm/LLMTransport';
import { serializeDemoContext, validateLLMResponse, ProviderResponseError } from '../agent/llm/PublicLLMContract';
import { demoContext, readDemo, seedDefect, EXPECTED } from '../demo/DemoAdapters';
import { assertDemoAgentConfigured } from '../demo/DemoAgentSelection';
import { AgentEditLoop } from '../agent/loop/AgentEditLoop';
import { PermissionManager } from '../permissions/PermissionManager';
import { MockApplicationBackend } from '../backend/MockApplicationBackend';
const root = process.cwd(), baseline = readDemo(root, 'src/main.c'), source = seedDefect(baseline);
const context = () => demoContext(root, source, 'Repair public Demo watchdog recovery');
const valid = () => ({ analysis: 'Restore watchdog timestamp for REQ-04', targetFile: 'main.c', expectation: EXPECTED, confidence: 'INFERRED',
  decision: { action: { kind: 'EDIT', proposal: { source: baseline, reason: 'Refresh timestamp on valid PING' } } } });
test('Mock transport receives selected bounded context; valid response maps to existing Plan', async () => {
  const transport = new MockLLMTransport([JSON.stringify(valid())]);
  const c = { ...context(), unrelatedRepository: 'DO_NOT_SEND' };
  const provider = new PublicLLMAgentProvider(c, transport);
  const plan = await provider.analyze({ text: 'repair recovery' }, new AbortController().signal);
  assert.equal(plan.source, baseline); assert.equal(plan.expectedOutput, EXPECTED);
  assert.equal(transport.requests.length, 1);
  const request = JSON.parse(transport.requests[0]);
  assert.equal(request.userRequest, 'repair recovery'); assert.equal(request.sources.length, 1);
  assert.equal(request.knowledge.length, 3); assert.ok(!transport.requests[0].includes('DO_NOT_SEND'));
});
test('raw response rejects malformed/schema/action/path/edit and permission bypass attempts', () => {
  const invalid: unknown[] = ['', 'not JSON', '```json\n{}\n```', '{}', 'null', '[]'];
  for (const targetFile of ['../main.c', '/tmp/main.c', 'C:\\outside.c', 'sdk/main.c']) { invalid.push(JSON.stringify({ ...valid(), targetFile })); }
  invalid.push(JSON.stringify({ ...valid(), approvePermission: true }));
  invalid.push(JSON.stringify({ ...valid(), confidence: 'CERTAIN' }));
  invalid.push(JSON.stringify({ ...valid(), decision: { action: { kind: 'RUN', command: 'shell' } } }));
  invalid.push(JSON.stringify({ ...valid(), decision: { action: { kind: 'EDIT', proposal: { source: baseline + '\n', reason: 'bad' } } } }));
  invalid.push(JSON.stringify({ ...valid(), decision: { action: { kind: 'EDIT', proposal: { source: baseline, reason: 'bad', bypassPermission: true } } } }));
  for (const raw of invalid) { assert.throws(() => validateLLMResponse(raw as string, source), ProviderResponseError); }
});
test('knowledge controller scope, source path, hash and context budget are enforced', () => {
  assert.throws(() => serializeDemoContext({ ...context(), sources: [{ relativePath: '../main.c', content: source, hash: 'bad' }] }), /scope/);
  assert.throws(() => serializeDemoContext({ ...context(), knowledge: [{ ...context().knowledge![0], controller: 'private-controller' }] }), /scope/);
  assert.throws(() => serializeDemoContext({ ...context(), sources: [{ ...context().sources[0], hash: 'bad' }] }), /hash/);
  assert.throws(() => serializeDemoContext({ ...context(), compiler: { stdout: 'x'.repeat(66000), stderr: '', exitCode: 1 } }), /budget/);
});
test('missing transport, ABORT, premature COMPLETE, cancellation and timeout fail closed', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(new PublicLLMAgentProvider(context()).analyze({ text: 'repair' }, signal), /NOT CONFIGURED/);
  for (const action of [{ kind: 'ABORT', reason: 'cannot repair' }, { kind: 'COMPLETE', assessment: { status: 'PASS', reason: 'claim', evidenceIds: [] } }]) {
    await assert.rejects(new PublicLLMAgentProvider(context(), new MockLLMTransport([JSON.stringify({ ...valid(), decision: { action } })])).analyze({ text: 'repair' }, signal), /ABORT|cannot bypass/);
  }
  const abort = new AbortController(); abort.abort('cancelled');
  const transport = new MockLLMTransport([JSON.stringify(valid())]);
  await assert.rejects(new PublicLLMAgentProvider(context(), transport).analyze({ text: 'repair' }, abort.signal), /cancelled/);
  assert.equal(transport.requests.length, 0);
  await assert.rejects(new PublicLLMAgentProvider(context(), { send: () => new Promise(() => {}) }, 10).analyze({ text: 'repair' }, signal), /timeout/);
});
test('existing EditLoop blocks malformed responses and requires Permission before a valid EDIT', async () => {
  class Spy extends MockApplicationBackend {
    writes = 0; builds = 0; runs = 0;
    override async writeApplication(id: string, content: string, hash: string) { this.writes++; return super.writeApplication(id, content, hash); }
    override async buildApplication() { this.builds++; return super.buildApplication(); }
    override async runApplication() { this.runs++; return super.runApplication(); }
  }
  for (const mode of ['malformed', 'deny-edit', 'allow-edit-deny-run']) {
    const backend = new Spy();
    const pm = new PermissionManager(async action => mode === 'allow-edit-deny-run' && action === 'write_file');
    const provider = new PublicLLMAgentProvider(context(), new MockLLMTransport([mode === 'malformed' ? '{}' : JSON.stringify(valid())]));
    const loop = new AgentEditLoop(root, provider, pm, () => backend, { iterations: 1 }, { summariesOnly: true, baseline: source });
    const result = await loop.start({ text: 'repair recovery' });
    assert.equal(result.status, 'FAIL'); assert.equal(backend.runs, 0);
    assert.equal(backend.writes, mode === 'allow-edit-deny-run' ? 1 : 0);
    assert.equal(backend.builds, mode === 'allow-edit-deny-run' ? 1 : 0);
    if (mode === 'malformed') { assert.equal(pm.audit.length, 0); }
    else { assert.ok(pm.audit.some(a => a.action === 'write_file')); }
  }
});
test('Panel Public LLM selection is NOT CONFIGURED and blocks both UI and host command', () => {
  assert.doesNotThrow(() => assertDemoAgentConfigured('deterministic'));
  assert.throws(() => assertDemoAgentConfigured('public-llm'), /NOT CONFIGURED/);
  const elements = new Map<string, any>(), messages: any[] = []; let receive!: Function;
  for (const m of readFileSync('media/panel.html', 'utf8').matchAll(/id="([^"]+)"/g)) elements.set(m[1], { value: '', dataset: {}, handlers: {}, addEventListener(type: string, cb: Function) { this.handlers[type] = cb; } });
  runInNewContext(readFileSync('media/panel.js', 'utf8'), { acquireVsCodeApi: () => ({ postMessage: (m: unknown) => messages.push(m) }),
    document: { getElementById: (id: string) => elements.get(id), querySelectorAll: () => [] }, window: { addEventListener: (_: string, cb: Function) => { receive = cb; } } });
  elements.get('demoAgent').handlers.change({ target: { value: 'public-llm' } });
  assert.equal(messages.at(-1).type, 'demoAgent');
  receive({ data: { type: 'state', state: { backend: 'mock' }, demoAgent: 'public-llm', busy: false } });
  assert.equal(elements.get('demoRun').disabled, true); assert.match(elements.get('demoAgentNotice').textContent, /NOT CONFIGURED/);
  receive({ data: { type: 'state', state: { backend: 'mock' }, demoAgent: 'deterministic', busy: false } });
  assert.equal(elements.get('demoRun').disabled, false);
  assert.match(readFileSync('src/extension.ts', 'utf8'), /const runDemoScenario = async \(\) => \{\s*assertDemoAgentConfigured\(demoAgent\)/);
});
