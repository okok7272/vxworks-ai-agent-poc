import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleBuffer } from '../backend/ConsoleBuffer';
import { MockBackend } from '../backend/MockBackend';
import { AgentController } from '../agent/AgentController';
import { MockAgentProvider } from '../agent/MockAgentProvider';
import { PermissionDenied, PermissionManager } from '../permissions/PermissionManager';
import { Action } from '../backend/VxWorksBackend';

test('AUTO build and console never prompt; target run denial does not start QEMU', async () => {
  let prompts = 0;
  const backend = new MockBackend();
  const manager = new PermissionManager(async () => { prompts++; return false; });
  const agent = new AgentController(backend, manager);
  await agent.execute('build'); await agent.execute('getConsole');
  assert.equal(prompts, 0);
  await assert.rejects(agent.execute('run'), PermissionDenied);
  assert.equal(prompts, 1); assert.equal(backend.state.qemu, 'Stopped');
  assert.equal(manager.audit.at(-1)?.allowed, false);
});

test('Full Validation requires both target permissions in one decision', async () => {
  let requested: readonly string[] = [];
  const manager = new PermissionManager(async (_action, permissions) => { requested = permissions; return true; });
  await new AgentController(new MockBackend(), manager).execute('fullValidation');
  assert.deepEqual(requested, ['target_run', 'target_stop']);
});

test('AUTO debug start cannot implicitly launch QEMU', async () => {
  const backend = new MockBackend();
  const agent = new AgentController(backend, new PermissionManager(async () => { throw new Error('Unexpected prompt'); }));
  await assert.rejects(agent.execute('debugStart'), /Start QEMU first/);
  assert.equal(backend.state.qemu, 'Stopped');
});

test('Agent routes through permissions; unsupported and destructive text cannot execute', async () => {
  const backend = new MockBackend();
  const agent = new MockAgentProvider(new AgentController(backend, new PermissionManager(async () => false)));
  await assert.rejects(agent.request('run'), PermissionDenied);
  for (const command of ['flash', 'reboot', 'memory write', 'run; reboot', 'constructor']) {
    await assert.rejects(agent.request(command));
  }
  assert.equal(backend.state.qemu, 'Stopped');
});

test('Unknown actions are denied including prototype property names', async () => {
  const permissions = new PermissionManager(async () => true);
  await assert.rejects(permissions.authorize('toString' as Action), PermissionDenied);
});

test('Stop requires permission and a denied stop leaves target running', async () => {
  const backend = new MockBackend();
  const controller = new AgentController(backend, new PermissionManager(async action => action !== 'stop'));
  await controller.execute('startQemu');
  await assert.rejects(controller.execute('stop'), PermissionDenied);
  assert.equal(backend.state.qemu, 'Running');
  await backend.dispose();
});

test('Console normalizes CR, bounds storage, supports tail and clear', () => {
  const console = new ConsoleBuffer(20);
  console.append('first\r\nsecond\r\nthird');
  assert.equal(console.read(2), 'second\nthird');
  assert.throws(() => console.read(-1), /positive integer/);
  console.append('01234567890123456789012345');
  assert.equal(console.read().length, 20);
  console.clear(); assert.equal(console.read(), '');
});

test('Concurrent state-changing commands cannot race permission prompts', async () => {
  let allow!: (value: boolean) => void;
  const controller = new AgentController(new MockBackend(), new PermissionManager(() => new Promise(resolve => { allow = resolve; })));
  const pending = controller.execute('startQemu');
  await assert.rejects(controller.execute('run'), /Another operation/);
  assert.equal(await controller.execute('getConsole'), '');
  allow(true); await pending;
  await controller.backend.dispose();
});
