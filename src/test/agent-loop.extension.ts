import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { activate } from '../extension';
import { LoopResult } from '../agent/loop/Types';
async function until(check: () => boolean) {
  const end = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > end) { throw new Error('Webview state timeout'); }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
export async function run() {
  const directory = join(resolve(__dirname, '../..'), 'artifacts', 'agent-loop-implementation');
  mkdirSync(directory, { recursive: true });
  const evidence: { status: string; checks: string[]; error?: string } = { status: 'FAIL', checks: [] };
  const extension = vscode.extensions.getExtension<Awaited<ReturnType<typeof activate>>>('local-vxworks.vxworks-agent')!;
  const api = await extension.activate();
  try {
    await vscode.commands.executeCommand('vxworksAgent.openPanel');
    await until(() => api.getRenderedState()?.backend === 'mock');
    api.setTestConfirmation(async () => true);
    const result = await vscode.commands.executeCommand<LoopResult>('vxworksAgent.runAgentLoop', { text: 'Print "Hello Agent"' });
    assert.equal(result.status, 'PASS'); assert.equal(result.backend, 'mock');
    await until(() => api.getRenderedLoopStatus() === 'PASS');
    evidence.checks.push('Registered Run Agent Loop command; simulated compile/runtime repair; PASS rendered in actual Webview');
    await vscode.commands.executeCommand('vxworksAgent.showDiff');
    assert.ok(vscode.window.activeTextEditor?.document.fileName.endsWith('diff.patch'));
    await vscode.commands.executeCommand('vxworksAgent.showEvidence');
    assert.ok(vscode.window.activeTextEditor?.document.fileName.endsWith('result.json'));
    evidence.checks.push('Show Diff and Show Evidence open actual run files');
    await vscode.commands.executeCommand('vxworksAgent.openPanel');
    api.setTestConfirmation(() => new Promise(() => {}));
    const work = api.runAgentLoop({ text: 'Cancel this fixture' });
    await until(() => api.getRenderedLoopStatus() === 'EDITING');
    await vscode.commands.executeCommand('vxworksAgent.cancelAgentLoop');
    assert.equal((await work)?.status, 'CANCELLED');
    await until(() => api.getRenderedLoopStatus() === 'CANCELLED');
    evidence.checks.push('Cancel command while permission pending; CANCELLED rendered');
    api.setTestConfirmation(async () => false);
    const denied = await api.runAgentLoop({ text: 'Denied write' });
    assert.equal(denied?.buildAttempts, 0); assert.equal(denied?.status, 'FAIL');
    evidence.checks.push('write_file denial prevents source application and build');
    evidence.status = 'PASS';
  } catch (error) { evidence.error = String(error); throw error; }
  finally { await api.cancelAgentLoop(); writeFileSync(join(directory, 'extension-tests.json'), JSON.stringify(evidence, null, 2)); }
}
