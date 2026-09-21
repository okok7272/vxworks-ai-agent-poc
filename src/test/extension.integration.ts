import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { activate } from '../extension';
import { Action, ExecutionResult, ValidationResult } from '../backend/VxWorksBackend';

async function until(condition: () => boolean, description: string, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) { throw new Error('Timed out: ' + description); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
export async function run() {
  const root = resolve(__dirname, '../..');
  const directory = join(root, 'artifacts', 'extension-host-' + Date.now());
  mkdirSync(directory, { recursive: true });
  const evidence: Record<string, unknown> = { checks: [] };
  const checks = evidence.checks as string[];
  const extension = vscode.extensions.getExtension<Awaited<ReturnType<typeof activate>>>('local-vxworks.vxworks-agent');
  assert.ok(extension, 'Extension discovered by VS Code');
  const api = await extension.activate();
  let allow = false;
  api.setTestConfirmation(async () => allow);
  try {
    assert.equal(api.getState().backend, 'mock');
    checks.push('Default MockBackend activated in real Extension Host');
    await vscode.commands.executeCommand('vxworksAgent.openPanel');
    await until(() => api.getRenderedState()?.backend === 'mock', 'Webview JS loaded and mock status rendered');
    checks.push('Panel HTML/CSS/JS loads and reports rendered state');
    await vscode.workspace.getConfiguration('vxworksAgent').update('backend', 'sdk', vscode.ConfigurationTarget.Workspace);
    await until(() => api.getRenderedState()?.backend === 'sdk' && api.getRenderedState()?.sdk === 'Ready', 'SDK selection and initialization', 60000);
    checks.push('Setting switches to SdkBackend; SDK Ready rendered');
    await assert.rejects(api.execute('startQemu'), /Permission denied/);
    assert.equal(api.getState().qemu, 'Stopped');
    checks.push('Denied target_run has no target side effect');
    evidence.build = await vscode.commands.executeCommand('vxworksAgent.build');
    assert.equal((evidence.build as ExecutionResult).exitCode, 0);
    checks.push('Registered Build command performs real RTP build');
    allow = true;
    await vscode.commands.executeCommand('vxworksAgent.startQemu');
    await until(() => api.getRenderedState()?.vxworks === 'Ready', 'VxWorks Ready rendered');
    checks.push('QEMU Running / VxWorks Ready rendered after boot pattern');
    await vscode.commands.executeCommand('vxworksAgent.debugStart');
    await until(() => api.getRenderedState()?.debugger === 'Connected', 'Debugger Connected rendered');
    checks.push('Registered Debug command connects wrdbg');
    evidence.run = await vscode.commands.executeCommand('vxworksAgent.agentRequest', 'run');
    assert.match((evidence.run as ExecutionResult).stdout, /Hello World/);
    const console = await api.execute('getConsole') as string;
    writeFileSync(join(directory, 'console.log'), console);
    assert.match(console, /Hello World/);
    checks.push('Agent -> PermissionManager -> SdkBackend -> RTP Hello World');
    allow = false;
    await assert.rejects(api.execute('stop'), /Permission denied/);
    assert.equal(api.getState().qemu, 'Running');
    checks.push('Denied target_stop leaves owned QEMU running');
    allow = true;
    await vscode.commands.executeCommand('vxworksAgent.debugStop');
    await vscode.commands.executeCommand('vxworksAgent.stop');
    await until(() => api.getRenderedState()?.qemu === 'Stopped' && api.getRenderedState()?.debugger === 'Disconnected', 'Stopped status rendered');
    checks.push('Debugger and QEMU stop, reflected in panel');
    evidence.validation = await vscode.commands.executeCommand('vxworksAgent.fullValidation');
    assert.equal((evidence.validation as ValidationResult).result?.status, 'PASS');
    assert.equal((evidence.validation as ValidationResult).exitCode, 0);
    await until(() => api.getRenderedValidationStatus() === 'PASS', 'Fresh result.json PASS displayed in Webview');
    checks.push('Full Validation invokes existing validate.py and reads fresh PASS result.json');
    evidence.permissions = api.getAudit();
    assert.ok(api.getAudit().some(entry => entry.action === 'fullValidation' &&
      entry.permissions.includes('target_run') && entry.permissions.includes('target_stop')));
    await vscode.workspace.getConfiguration('vxworksAgent').update('backend', 'mock', vscode.ConfigurationTarget.Workspace);
    await until(() => api.getState().backend === 'mock', 'Return to mock');
    checks.push('SDK -> Mock swap succeeds');
    evidence.status = 'PASS';
    process.stdout.write('EXTENSION HOST PASS: ' + checks.length + ' checks\n');
  } catch (error) {
    evidence.status = 'FAIL'; evidence.error = String(error);
    throw error;
  } finally {
    allow = true;
    try { await api.execute('stop' as Action); } catch { /* failure evidence retained */ }
    writeFileSync(join(directory, 'result.json'), JSON.stringify(evidence, null, 2));
    process.stdout.write('Extension evidence: ' + directory + '\n');
  }
}
