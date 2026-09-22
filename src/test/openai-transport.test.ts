import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { OpenAIResponsesTransport, OPENAI_ENDPOINT, DEFAULT_OPENAI_MODEL, openAIConfiguration, openAISmoke, OPENAI_SMOKE_INPUT } from '../agent/llm/OpenAIResponsesTransport';
import { PublicLLMAgentProvider } from '../agent/PublicLLMAgentProvider';
import { DemoProvider } from '../demo/DemoProvider';
import { demoContext, readDemo, seedDefect, EXPECTED } from '../demo/DemoAdapters';
const key = ['fake', 'test', 'credential'].join('-');
const env = () => ({ OPENAI_API_KEY: key });
const signal = () => new AbortController().signal;
const baseline = readDemo(process.cwd(), 'src/main.c'), source = seedDefect(baseline);
const context = () => demoContext(process.cwd(), source, 'Repair the public recovery defect');
const valid = () => ({ analysis: 'Refresh the timestamp', targetFile: 'main.c', expectation: EXPECTED, confidence: 'INFERRED',
  decision: { action: { kind: 'EDIT', proposal: { source: baseline, reason: 'REQ-04 recovery' } } } });
const envelope = (text: string) => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
const http = (body: unknown): typeof fetch => async () => new Response(JSON.stringify(body));

test('request serialization uses fixed Responses endpoint, strict existing schema, configured model; key only in header', async () => {
  let calls = 0;
  const transport = new OpenAIResponsesTransport(async (url, init) => {
    calls++; assert.equal(url, OPENAI_ENDPOINT); assert.equal(init?.redirect, 'error');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer ' + key);
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, 'custom-model'); assert.equal(body.store, false); assert.equal(body.tools, undefined);
    assert.equal(body.text.format.strict, true); assert.equal(body.text.format.schema.additionalProperties, false);
    assert.equal(body.text.format.schema.properties.decision.properties.action.anyOf.length, 3);
    assert.ok(!(init!.body as string).includes(key));
    const c = JSON.parse(body.input); assert.equal(c.sources[0].relativePath, 'main.c'); assert.equal(c.knowledge.length, 3);
    return new Response(JSON.stringify(envelope(JSON.stringify(valid()))));
  }, () => ({ ...env(), VXWORKS_AGENT_OPENAI_MODEL: 'custom-model' }));
  const plan = await new PublicLLMAgentProvider(context(), transport).analyze(context().request, signal());
  assert.equal(plan.source, baseline); assert.equal(calls, 1);
  assert.equal(openAIConfiguration(env()).model, DEFAULT_OPENAI_MODEL);
});
test('missing key and invalid model are NOT CONFIGURED; no fetch or secret in configuration', async () => {
  let calls = 0; const fetcher: typeof fetch = async () => { calls++; throw new Error(); };
  for (const settings of [{}, { OPENAI_API_KEY: '   ' }, { ...env(), VXWORKS_AGENT_OPENAI_MODEL: key }]) {
    assert.equal(openAIConfiguration(settings).status, 'NOT CONFIGURED');
    assert.ok(!JSON.stringify(openAIConfiguration(settings)).includes(key));
    await assert.rejects(new OpenAIResponsesTransport(fetcher, () => settings).send('{}', signal()), /NOT CONFIGURED/);
  }
  assert.equal(calls, 0);
});
test('parsing rejects refusal, incomplete, missing output, tool output and malformed JSON', async () => {
  const cases = [{}, { ...envelope('{}'), status: 'incomplete' },
    { status: 'completed', output: [{ type: 'function_call' }] },
    { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'no' }] }] }];
  for (const body of cases) { await assert.rejects(new OpenAIResponsesTransport(http(body), env).send('{}', signal()), /invalid/); }
  await assert.rejects(new OpenAIResponsesTransport(async () => new Response('not json'), env).send('{}', signal()), /invalid/);
});
test('local structured validator still rejects path escape, extra commands, malformed edit and premature COMPLETE', async () => {
  const responses = [{ ...valid(), targetFile: '../main.c' }, { ...valid(), command: 'shell' },
    { ...valid(), decision: { action: { kind: 'EDIT', proposal: { source: baseline + '\n', reason: 'extra change' } } } },
    { ...valid(), decision: { action: { kind: 'COMPLETE', assessment: { status: 'PASS', reason: 'claim', evidenceIds: [] } } } }];
  for (const r of responses) {
    await assert.rejects(new PublicLLMAgentProvider(context(), new OpenAIResponsesTransport(http(envelope(JSON.stringify(r))), env)).analyze(context().request, signal()));
  }
});
test('AbortSignal reaches HTTP; pre-abort sends nothing; timeout stops in-flight fetch', async () => {
  let calls = 0;
  const pending: typeof fetch = async (_, init) => { calls++; return new Promise((_, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new Error(key)), { once: true });
  }); };
  const aborted = new AbortController(); aborted.abort(key);
  await assert.rejects(new OpenAIResponsesTransport(pending, env).send('{}', aborted.signal), /cancelled/);
  assert.equal(calls, 0);
  const active = new AbortController(); const work = new OpenAIResponsesTransport(pending, env).send('{}', active.signal);
  active.abort(key); await assert.rejects(work, /cancelled/);
  await assert.rejects(new OpenAIResponsesTransport(pending, env, 10).send('{}', signal()), /timed out/);
  assert.equal(calls, 2);
});
test('network/service errors, reflected credentials and outbound private paths never leak secrets or retry', async () => {
  let calls = 0;
  for (const fetcher of [async () => { calls++; throw new Error(key); },
    async () => { calls++; return new Response(key, { status: 401 }); },
    async () => { calls++; return new Response(JSON.stringify(envelope(key))); }]) {
    await assert.rejects(new OpenAIResponsesTransport(fetcher, env).send('{}', signal()), (error: Error) => {
      assert.ok(!String(error).includes(key)); assert.equal(error.cause, undefined); return true;
    });
  }
  assert.equal(calls, 3);
  for (const input of [key, JSON.stringify({ path: 'C:\\Users\\someone' }), '/home/private/file', '{"password":"private"}']) {
    await assert.rejects(new OpenAIResponsesTransport(async () => { calls++; throw new Error(); }, env).send(input, signal()), /Outbound/);
  }
  assert.equal(calls, 3);
});
test('smoke uses one tiny no-source request and validates ABORT without any tools', async () => {
  let calls = 0;
  const transport = new OpenAIResponsesTransport(async (_, init) => {
    calls++; assert.equal(JSON.parse(init!.body as string).input, OPENAI_SMOKE_INPUT);
    return new Response(JSON.stringify(envelope(JSON.stringify({ ...valid(), decision: { action: { kind: 'ABORT', reason: 'smoke only' } } }))));
  }, env);
  assert.deepEqual(await openAISmoke(transport), { status: 'PASS', action: 'ABORT', requests: 1, toolsExecuted: 0 });
  assert.equal(calls, 1);
});
test('Demo repair handoff uses HTTP judgement and returns a proposal only, preserving baseline', async () => {
  const provider = new DemoProvider(process.cwd(), baseline, new OpenAIResponsesTransport(http(envelope(JSON.stringify(valid()))), env));
  const prepared = await provider.analyze({ text: 'repair public Demo' }, signal());
  assert.equal(prepared.source, source);
  const proposal = await provider.repair({ source, expectedOutput: EXPECTED, kind: 'runtime', diagnostic: 'watchdog=0', actualOutput: 'watchdog=0', iteration: 1 }, signal());
  assert.equal(proposal.source, baseline); assert.equal(readDemo(process.cwd(), 'src/main.c'), baseline);
  assert.equal(provider.contexts.length, 2); assert.equal(provider.responses.length, 1);
  // The handoff has no backend: the unchanged loop owns permission before every write.
  const loop = readFileSync('src/agent/loop/AgentEditLoop.ts', 'utf8');
  assert.ok(loop.indexOf("permissions.authorize('write_file'") < loop.indexOf('backend.writeApplication('));
  assert.ok(loop.includes("permissions.authorize('write_file'"));
});
test('Panel gates Public LLM by safe configuration status and displays model', () => {
  const elements = new Map<string, any>(); let receive!: Function;
  for (const m of readFileSync('media/panel.html', 'utf8').matchAll(/id="([^"]+)"/g)) elements.set(m[1], { value: '', dataset: {}, addEventListener() {} });
  runInNewContext(readFileSync('media/panel.js', 'utf8'), { acquireVsCodeApi: () => ({ postMessage() {} }),
    document: { getElementById: (id: string) => elements.get(id), querySelectorAll: () => [] }, window: { addEventListener: (_: string, cb: Function) => { receive = cb; } } });
  for (const ready of [false, true]) {
    receive({ data: { type: 'state', state: { backend: 'mock' }, demoAgent: 'public-llm', publicLlm: openAIConfiguration(ready ? env() : {}), busy: false } });
    assert.equal(elements.get('demoRun').disabled, !ready);
    assert.match(elements.get('demoAgentNotice').textContent, new RegExp(ready ? 'READY' : 'NOT CONFIGURED'));
    assert.ok(elements.get('demoAgentNotice').textContent.includes(DEFAULT_OPENAI_MODEL));
  }
});
