const { fork } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const assert = require('node:assert/strict');
const { SdkBackend } = require('../dist/backend/SdkBackend');
const { WslRunner } = require('../dist/backend/WslRunner');
const root = resolve(__dirname, '..');

async function gone(pids) {
  const wsl = new WslRunner();
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = await wsl.capture('/usr/bin/python3', ['-c',
      'import pathlib,sys,json; print(json.dumps([p for p in sys.argv[1:] if pathlib.Path("/proc",p).exists()]))',
      ...pids.map(String)]);
    if (JSON.parse(result).length === 0) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Owned Linux process survived parent cleanup: ' + pids.join(', '));
}
async function main() {
  if (process.argv.includes('--owner')) {
    const backend = new SdkBackend(root);
    await backend.startQemu(); await backend.debugStart();
    process.send({ ready: true, state: backend.state });
    return; // Keep the bridge handles open until the parent terminates this Node process.
  }
  const output = join(root, 'artifacts', 'extension-lifecycle-' + Date.now());
  mkdirSync(output, { recursive: true });
  const result = { checks: [], status: 'FAIL' };
  try {
    const backend = new SdkBackend(root);
    await backend.startQemu(); await backend.debugStart();
    const pids = [backend.state.qemuPid, backend.state.debuggerPid];
    await backend.dispose();
    await gone(pids);
    result.checks.push('dispose terminates running QEMU and wrdbg');
    console.log('PASS dispose cleanup');
    const child = fork(__filename, ['--owner'], { silent: true, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const state = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Owner startup timed out: ' + stderr)); }, 90000);
      child.once('message', message => { clearTimeout(timer); resolve(message.state); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Owner exited early: ' + code + ' ' + stderr)); });
    });
    assert.equal(state.debugger, 'Connected');
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill(); // Simulate extension host termination, not a graceful dispose.
    await exited;
    await gone([state.qemuPid, state.debuggerPid]);
    result.checks.push('parent EOF after Node termination cleans QEMU and wrdbg');
    console.log('PASS abrupt parent cleanup');
    result.status = 'PASS';
  } catch (error) {
    result.error = String(error);
    throw error;
  } finally {
    writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log('Lifecycle evidence: ' + output);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
