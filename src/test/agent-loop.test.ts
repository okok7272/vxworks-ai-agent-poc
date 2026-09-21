import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentEditLoop } from '../agent/loop/AgentEditLoop';
import { RuleBasedAgentProvider } from '../agent/RuleBasedAgentProvider';
import { MockApplicationBackend } from '../backend/MockApplicationBackend';
import { PermissionManager } from '../permissions/PermissionManager';
import { AgentProvider } from '../agent/AgentProvider';
import { LoopLimits } from '../agent/loop/Types';

function setup(provider: AgentProvider = new RuleBasedAgentProvider(), backend = new MockApplicationBackend(), limits: Partial<LoopLimits> = {}, allow = async () => true) {
  const permissions = new PermissionManager(allow);
  return { loop: new AgentEditLoop(process.cwd(), provider, permissions, () => backend, limits), backend, permissions };
}
test('combined diagnostic repair, rebuild, runtime repair, evidence, permissions and cleanup', async () => {
  const { loop, backend, permissions } = setup(); const states: string[] = [];
  loop.on('state', view => states.push(view.status));
  const result = await loop.start({ text: 'Print "Hello Agent"' });
  assert.equal(result.status, 'PASS'); assert.equal(result.iterationCount, 3);
  assert.equal(result.buildAttempts, 3); assert.equal(result.runtimeAttempts, 2);
  assert.equal(result.actualOutput.trim(), 'Hello Agent'); assert.equal(result.cleanup, 'complete');
  assert.equal(backend.state.qemu, 'Stopped');
  assert.equal(permissions.audit.filter(a => a.action === 'write_file').length, 3);
  assert.equal(permissions.audit.filter(a => a.action === 'agent_loop_run').length, 2);
  for (const state of ['ANALYZING', 'EDITING', 'BUILDING', 'FIXING', 'RUNNING', 'VALIDATING', 'PASS']) { assert.ok(states.includes(state), state); }
  for (const name of ['result.json', 'diff.patch', 'build.log', 'runtime.log', 'iterations.json']) { assert.ok(readFileSync(join(result.evidenceDirectory, name), 'utf8').length, name); }
  const iterations = JSON.parse(readFileSync(join(result.evidenceDirectory, 'iterations.json'), 'utf8'));
  assert.equal(iterations[0].build.exitCode, 1); assert.equal(iterations[1].validation.passed, false);
  assert.equal(iterations[2].validation.passed, true);
});
test('write denial preserves source and never builds', async () => {
  const { loop, backend } = setup(undefined, undefined, {}, async () => false);
  const result = await loop.start({ text: 'Hello' });
  assert.equal(result.status, 'FAIL'); assert.equal(result.buildAttempts, 0); assert.equal(backend.source, '');
});
test('cancel pending permission terminates loop and preserves evidence', async () => {
  const { loop } = setup(undefined, undefined, {}, () => new Promise(() => {}));
  const work = loop.start({ text: 'Hello' });
  await new Promise<void>(resolve => loop.on('state', view => { if (view.status === 'EDITING') { resolve(); } }));
  await loop.cancel(); const result = await work;
  assert.equal(result.status, 'CANCELLED'); assert.equal(result.cleanup, 'complete'); assert.equal(result.buildAttempts, 0);
});
test('cancel provider that ignores AbortSignal', async () => {
  const { loop } = setup({ id: 'blocked', analyze: () => new Promise(() => {}), repair: () => new Promise(() => {}) });
  const work = loop.start({ text: 'Hello' }); await loop.cancel(); assert.equal((await work).status, 'CANCELLED');
});
test('same compiler error stops on second occurrence', async () => {
  const rule = new RuleBasedAgentProvider();
  const { loop } = setup({ id: 'no-fix', analyze: rule.analyze.bind(rule), repair: async c => ({ source: c.source + '\n', reason: 'Non-fix' }) });
  const result = await loop.start({ text: 'Hello' });
  assert.equal(result.buildAttempts, 2); assert.match(result.failureReason!, /Repeated identical/);
});
test('compile fix limit 3 and global iteration limit', async () => {
  class Broken extends MockApplicationBackend {
    attempt = 0;
    override async buildApplication() { return { command: ['test'], stdout: '', stderr: 'error: distinct ' + ++this.attempt, exitCode: 1 }; }
  }
  const rule = new RuleBasedAgentProvider();
  const provider: AgentProvider = { id: 'bounded', analyze: rule.analyze.bind(rule), repair: async c => ({ source: c.source + '\n', reason: 'Test distinct failure' }) };
  const { loop } = setup(provider, new Broken());
  const result = await loop.start({ text: 'Hello' });
  assert.equal(result.buildAttempts, 4); assert.equal(result.compileFixes, 3); assert.match(result.failureReason!, /compile fix limit/);
  const limited = await setup(provider, new Broken(), { iterations: 2 }).loop.start({ text: 'Hello' });
  assert.equal(limited.iterationCount, 2); assert.match(limited.failureReason!, /iteration limit/);
});
test('runtime repair limit is 2', async () => {
  class Wrong extends MockApplicationBackend {
    attempt = 0;
    override async runApplication() { return { stdout: '', stderr: '', exitCode: 0, completed: true, actualOutput: 'wrong ' + ++this.attempt }; }
  }
  const rule = new RuleBasedAgentProvider();
  const { loop } = setup({ id: 'runtime', analyze: rule.analyze.bind(rule), repair: async c => ({ source: c.source + '\n', reason: 'Test distinct runtime failure' }) }, new Wrong());
  const result = await loop.start({ text: 'Hello', scenario: 'runtime' });
  assert.equal(result.runtimeAttempts, 3); assert.equal(result.runtimeFixes, 2); assert.match(result.failureReason!, /runtime fix limit/);
});
test('overall timeout fails and concurrent starts cannot overlap', async () => {
  const { loop } = setup({ id: 'blocked', analyze: () => new Promise(() => {}), repair: () => new Promise(() => {}) }, undefined, { timeoutMs: 20 });
  const work = loop.start({ text: 'Hello' });
  await assert.rejects(loop.start({ text: 'other' }), /already active/);
  const result = await work; assert.equal(result.status, 'FAIL'); assert.match(result.failureReason!, /timeout/);
});
