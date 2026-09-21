import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { DemoRunner, DEMO_COMMANDS } from '../demo/DemoRunner';
import { DemoBackend } from '../demo/DemoBackend';
import { demoContext, adaptResponse, readDemo, seedDefect, digest, FIX, EXPECTED } from '../demo/DemoAdapters';
import { PermissionManager } from '../permissions/PermissionManager';
const root = process.cwd();

test('selected context, history, response scope and COMPLETE/ABORT contract', () => {
  const source = seedDefect(readDemo(root, 'src/main.c'));
  const context = demoContext(root, source, 'repair recovery');
  assert.equal(context.controller.id, 'demo-controller'); assert.equal(context.knowledge?.length, 3);
  assert.ok(context.knowledge?.find(k => k.id === 'REQUIREMENTS')?.content.includes('REQ-04'));
  assert.ok(context.knowledge![2].content.length < readDemo(root, 'docs/REQUIREMENTS.md').length);
  const base = { analysis: 'fix watchdog refresh', targetFile: 'main.c', expectation: EXPECTED };
  assert.throws(() => adaptResponse({ ...base, targetFile: '../main.c' }, source), /scope/);
  assert.throws(() => adaptResponse({ ...base, decision: { action: { kind: 'RUN', reason: 'bypass' } } }, source), /Unsupported/);
  assert.throws(() => adaptResponse({ ...base, decision: { action: { kind: 'ABORT', reason: 'stop' } } }, source), /ABORT/);
  assert.throws(() => adaptResponse({ ...base, decision: { action: { kind: 'COMPLETE' } } }, source), /assessment/);
  assert.equal(adaptResponse({ ...base, decision: { action: { kind: 'COMPLETE', assessment: { status: 'PASS', reason: 'proposal only', evidenceIds: ['iteration-2'] } } } }, source), 'COMPLETE');
});
test('model refuses a drifted baseline rather than pretending to compile arbitrary C', () => {
  assert.doesNotThrow(() => new DemoBackend(root, readDemo(root, 'src/main.c')));
  assert.throws(() => new DemoBackend(root, readDemo(root, 'src/main.c') + '\n/* drift */'), /reviewed v1 baseline/);
});
test('Demo runs twice through existing loop, repairs model and preserves baseline with compact evidence', async () => {
  const before = digest(readFileSync(join(root, 'demo/controller/src/main.c'), 'utf8'));
  for (let repeat = 0; repeat < 2; repeat++) {
    const pm = new PermissionManager(async () => true);
    const runner = new DemoRunner(root, root, pm);
    const result = await runner.start() as any;
    assert.equal(result.status, 'PASS', result.failureReason); assert.equal(result.iterationCount, 2);
    assert.equal(result.actualOutput, EXPECTED); assert.equal(result.baselineUnchanged, true);
    assert.equal(result.simulated, true); assert.equal(result.cleanup, 'complete');
    assert.equal(pm.audit.filter(a => a.action === 'write_file' && a.allowed).length, 2);
    const directory = result.evidenceDirectory;
    assert.ok(!readdirSync(directory).some(name => name.endsWith('.c') || name === 'work'));
    const patch = readFileSync(join(directory, 'diff.patch'), 'utf8');
    assert.match(patch, /watchdog_ms/); assert.ok(!patch.includes('int main'));
    const contexts = JSON.parse(readFileSync(join(directory, 'agent-context.json'), 'utf8'));
    assert.equal(contexts[1].history.length, 1); assert.match(contexts[1].runtime.actualOutput, /watchdog=0/);
    assert.equal(contexts[0].sources[0].content, undefined);
    assert.ok(!readFileSync(join(directory, 'plan.json'), 'utf8').includes('#include'));
    assert.ok(readFileSync(join(directory, 'validation.log'), 'utf8').includes(EXPECTED));
    assert.equal(digest(readFileSync(join(root, 'demo/controller/src/main.c'), 'utf8')), before);
  }
});
test('Demo write denial and Cancel while awaiting edit approval preserve baseline and evidence', async () => {
  const baseline = readDemo(root, 'src/main.c');
  const denied = await new DemoRunner(root, root, new PermissionManager(async () => false)).start() as any;
  assert.equal(denied.status, 'FAIL'); assert.equal(denied.buildAttempts, 0);
  const runner = new DemoRunner(root, root, new PermissionManager(() => new Promise(() => {})));
  const ready = new Promise<void>(resolve => runner.on('state', state => { if (state.status === 'EDITING') { resolve(); } }));
  const work = runner.start(); await ready; await runner.cancel();
  assert.equal((await work as any).status, 'CANCELLED');
  assert.equal(readDemo(root, 'src/main.c'), baseline);
});
test('Panel buttons, message handlers and registered command IDs agree; Cancel remains enabled', () => {
  const html = readFileSync('media/panel.html', 'utf8');
  const script = readFileSync('media/panel.js', 'utf8');
  const extension = readFileSync('src/extension.ts', 'utf8');
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const elements = new Map<string, any>(); const messages: any[] = []; let receive!: Function;
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], { dataset: {}, disabled: false, value: '', handlers: {} });
  for (const element of elements.values()) element.addEventListener = (type: string, handler: Function) => { element.handlers[type] = handler; };
  runInNewContext(script, { acquireVsCodeApi: () => ({ postMessage: (m: unknown) => messages.push(m) }),
    document: { getElementById: (id: string) => elements.get(id), querySelectorAll: () => [] },
    window: { addEventListener: (_type: string, handler: Function) => { receive = handler; } } });
  for (const [type, command] of Object.entries(DEMO_COMMANDS)) {
    elements.get(type).handlers.click(); assert.equal(messages.at(-1).type, type);
    assert.ok(manifest.contributes.commands.some((c: any) => c.command === 'vxworksAgent.' + command));
  }
  assert.match(extension, /Object\.hasOwn\(demoHandlers, message.type\)/);
  assert.match(extension, /DEMO_COMMANDS\[type\], demoHandlers\[type\]/);
  receive({ data: { type: 'state', state: { backend: 'mock' }, busy: true, demo: { status: 'EDITING', active: true, evidenceDirectory: 'evidence' } } });
  assert.equal(elements.get('demoStatus').textContent, 'EDITING'); assert.equal(elements.get('demoCancel').disabled, false);
});
