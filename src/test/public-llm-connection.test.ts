import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { CONNECTION_COMMAND, testPublicLlmConnection } from '../agent/llm/PublicLLMConnectionTest';
import { OpenAIResponsesTransport, OPENAI_SMOKE_INPUT } from '../agent/llm/OpenAIResponsesTransport';
import { EXPECTED } from '../demo/DemoAdapters';
const config = { status: 'READY', provider: 'OpenAI', model: 'gpt-5.6-luna' };
const key = ['synthetic', 'credential', 'only'].join('-');
const signal = () => new AbortController().signal;
const response = JSON.stringify({ analysis: 'Smoke only', targetFile: 'main.c', expectation: EXPECTED, confidence: 'UNKNOWN',
  decision: { action: { kind: 'ABORT', reason: 'smoke only' } } });

test('connection success uses current HTTP transport and validator exactly once without tools', async () => {
  let calls = 0;
  const transport = new OpenAIResponsesTransport(async (_, init) => {
    calls++; const body = JSON.parse(init!.body as string);
    assert.equal(body.input, OPENAI_SMOKE_INPUT); assert.equal(body.model, config.model); assert.equal(body.tools, undefined);
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: response }] }] }));
  }, () => ({ OPENAI_API_KEY: key }));
  assert.deepEqual(await testPublicLlmConnection(signal(), config, () => transport),
    { api: 'CONNECTED', provider: 'OpenAI', model: config.model, structuredValidation: 'PASS' });
  assert.equal(calls, 1);
});
test('HTTP failure is redacted and never retried', async () => {
  let calls = 0;
  const transport = new OpenAIResponsesTransport(async () => { calls++; return new Response(key, { status: 401 }); }, () => ({ OPENAI_API_KEY: key }));
  const result = await testPublicLlmConnection(signal(), config, () => transport);
  assert.equal(result.api, 'FAILED'); assert.equal(result.httpStatus, 401);
  assert.ok(!JSON.stringify(result).includes(key)); assert.equal(calls, 1);
});
test('malformed and secret-bearing exceptions fail closed; missing key sends zero requests', async () => {
  let calls = 0;
  for (const mode of ['malformed', 'secret']) {
    const result = await testPublicLlmConnection(signal(), config, () => ({ send: async () => {
      calls++; if (mode === 'secret') throw new Error(key); return '{}';
    } }));
    assert.equal(result.api, 'FAILED'); assert.ok(!JSON.stringify(result).includes(key));
  }
  assert.equal(calls, 2);
  const result = await testPublicLlmConnection(signal(), { ...config, status: 'NOT CONFIGURED' }, () => { throw new Error('must not instantiate'); });
  assert.equal(result.error, 'NOT CONFIGURED');
});
test('command/handler and Webview button route only to smoke; duplicate pending clicks send one message', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.ok(pkg.contributes.commands.some((c: any) => c.command === CONNECTION_COMMAND));
  const extension = readFileSync('src/extension.ts', 'utf8');
  assert.ok(extension.includes('registerCommand(CONNECTION_COMMAND, testConnection)'));
  assert.ok(extension.includes("message?.type === 'testPublicLlmConnection') { await testConnection(); }"));
  const handler = extension.slice(extension.indexOf('const testConnection ='), extension.indexOf('registerCommand(CONNECTION_COMMAND'));
  assert.ok(handler.includes('if (connectionAbort || busyCount'));
  assert.ok(!/controller\.|backend\.|demo\.start|loop\.start|permissions\./.test(handler));
  const elements = new Map<string, any>(), messages: any[] = []; let receive!: Function;
  for (const m of readFileSync('media/panel.html', 'utf8').matchAll(/id="([^"]+)"/g)) elements.set(m[1], { value: '', dataset: {}, handlers: {}, addEventListener(type: string, cb: Function) { this.handlers[type] = cb; } });
  runInNewContext(readFileSync('media/panel.js', 'utf8'), { acquireVsCodeApi: () => ({ postMessage: (m: any) => messages.push(m) }),
    document: { getElementById: (id: string) => elements.get(id), querySelectorAll: () => [] }, window: { addEventListener: (_: string, cb: Function) => { receive = cb; } } });
  const button = elements.get('testPublicLlmConnection'); button.handlers.click(); button.handlers.click();
  assert.equal(messages.filter(m => m.type === 'testPublicLlmConnection').length, 1);
  receive({ data: { type: 'connectionState', active: false, result: { api: 'CONNECTED', provider: 'OpenAI', model: config.model, structuredValidation: 'PASS' } } });
  assert.match(elements.get('connectionResult').textContent, /API: CONNECTED[\s\S]*Structured Validation: PASS/);
  receive({ data: { type: 'connectionState', active: false, result: { api: 'FAILED', provider: 'OpenAI', model: config.model, httpStatus: 401, error: 'OpenAI request rejected' } } });
  assert.match(elements.get('connectionResult').textContent, /API: FAILED[\s\S]*HTTP: 401/);
});
