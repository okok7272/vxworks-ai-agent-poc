import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SdkBackend } from '../backend/SdkBackend';
import { AgentController } from '../agent/AgentController';
import { PermissionManager } from '../permissions/PermissionManager';
import { WslRunner } from '../backend/WslRunner';
import { BackendState, EnvironmentResult, ExecutionResult, ValidationResult } from '../backend/VxWorksBackend';

async function main() {
  const root = resolve(__dirname, '../..');
  const logDir = join(root, 'artifacts', 'extension-sdk-' + Date.now());
  mkdirSync(logDir, { recursive: true });
  const backend = new SdkBackend(root);
  const states: BackendState[] = [];
  backend.on('state', state => states.push({ ...state }));
  const permissions = new PermissionManager(async () => true); // User-authorized local integration test.
  const controller = new AgentController(backend, permissions);
  const results: Record<string, unknown> = {};
  const wsl = new WslRunner();
  const hashes = () => wsl.capture('/usr/bin/python3', ['-c',
    'import hashlib,json,pathlib; p=pathlib.Path.home()/"vxworks-qemu-test/scripts"; print(json.dumps({x.name:hashlib.sha256(x.read_bytes()).hexdigest() for x in p.iterdir() if x.is_file()},sort_keys=True))']);
  const expectedBinary = await wsl.capture('/usr/bin/python3', ['-c', 'import pathlib; print(pathlib.Path.home()/"vxworks-qemu-test/bin/helloworld.vxe")']);
  const before = await hashes();
  try {
    results.environment = await controller.execute('validateEnvironment');
    assert.equal((results.environment as EnvironmentResult).ready, true, JSON.stringify(results.environment));
    console.log('PASS SDK environment');
    await assert.rejects(controller.execute('debugStart'), /Start QEMU first/);
    assert.equal(backend.state.qemu, 'Stopped');
    console.log('PASS AUTO debugger cannot bypass target_run');
    results.clean = await controller.execute('clean');
    results.build = await controller.execute('build');
    assert.equal((results.build as ExecutionResult).exitCode, 0);
    assert.equal((results.build as ExecutionResult).outputFile, expectedBinary);
    console.log('PASS clean + real RTP build');
    results.boot = await controller.execute('startQemu');
    assert.equal(backend.state.vxworks, 'Ready');
    assert.ok(states.some(state => state.vxworks === 'Booting'));
    assert.match(await backend.getConsole(), /Release version: 21.03/);
    console.log('PASS QEMU boot + prompt detection');
    // A second backend must not steal or terminate the first backend's QEMU.
    const competitor = new SdkBackend(root);
    try {
      await assert.rejects(competitor.startQemu(), /Another SDK extension owns/);
      assert.equal(backend.state.qemu, 'Running');
    } finally { await competitor.dispose(); }
    console.log('PASS ownership lock protects existing QEMU');
    results.debug = await controller.execute('debugStart');
    assert.equal(backend.state.debugger, 'Connected');
    results.run = await controller.execute('run');
    assert.match((results.run as ExecutionResult).stdout, /Hello World/);
    assert.match(await controller.execute('getConsole') as string, /Hello World/);
    console.log('PASS wrdbg connect + RTP run + console');
    await assert.rejects(controller.execute('fullValidation'), /Stop this backend/);
    await controller.execute('debugStop');
    assert.equal(backend.state.debugger, 'Disconnected');
    await controller.execute('stop');
    assert.equal(backend.state.qemu, 'Stopped');
    console.log('PASS debugger + QEMU stopped');
    results.validation = await controller.execute('fullValidation');
    assert.equal((results.validation as ValidationResult).exitCode, 0);
    assert.equal((results.validation as ValidationResult).result?.status, 'PASS');
    console.log('PASS existing validate.py + fresh result.json');
    writeFileSync(join(logDir, 'console.log'), await backend.getConsole());
    assert.ok((await backend.getConsole(10)).split('\n').length <= 10);
    await controller.execute('clearConsole');
    assert.equal(await backend.getConsole(), '');
    assert.equal(await hashes(), before, 'Existing scripts must not change');
    console.log('PASS console tail/clear + existing scripts unchanged');
    results.status = 'PASS';
  } catch (error) {
    results.status = 'FAIL'; results.error = String(error);
    writeFileSync(join(logDir, 'console.log'), await backend.getConsole());
    throw error;
  } finally {
    await backend.dispose();
    results.states = states; results.permissions = permissions.audit;
    writeFileSync(join(logDir, 'result.json'), JSON.stringify(results, null, 2));
    console.log('Evidence: ' + logDir);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
