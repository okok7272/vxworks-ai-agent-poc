import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MockBackend } from './backend/MockBackend';
import { SdkBackend } from './backend/SdkBackend';
import { Action, BackendState, VxWorksBackend } from './backend/VxWorksBackend';
import { ACTION_PERMISSIONS, Permission, PermissionAction, PermissionManager } from './permissions/PermissionManager';
import { AgentController } from './agent/AgentController';
import { AgentEditLoop } from './agent/loop/AgentEditLoop';
import { RuleBasedAgentProvider } from './agent/RuleBasedAgentProvider';
import { MockApplicationBackend } from './backend/MockApplicationBackend';
import { LoopRequest } from './agent/loop/Types';
import { ConsoleBuffer } from './backend/ConsoleBuffer';
import { DemoRunner, DEMO_COMMANDS } from './demo/DemoRunner';
import { DemoAgentSelection, DEMO_AGENT_OPTIONS, assertDemoAgentConfigured } from './demo/DemoAgentSelection';
import { OpenAIResponsesTransport, openAIConfiguration } from './agent/llm/OpenAIResponsesTransport';
import { MockAgentProvider } from './agent/MockAgentProvider';

let cleanup: (() => Promise<void>) | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('VxWorks Agent');
  context.subscriptions.push(output);
  let panel: vscode.WebviewPanel | undefined;
  let lastRendered: BackendState | undefined;
  let renderedValidationStatus: string | undefined;
  let lastResult: unknown;
  let testConfirm: ((action: PermissionAction, permissions: readonly Permission[]) => Promise<boolean>) | undefined;
  let controller!: AgentController;
  let backend!: VxWorksBackend;
  let provider: MockAgentProvider;
  let switching = false;
  let busyCount = 0;
  let loop: AgentEditLoop | undefined;
  let demo: DemoRunner | undefined;
  let demoAgent: DemoAgentSelection = 'deterministic';
  const loopConsole = new ConsoleBuffer();
  let renderedLoopStatus: string | undefined;
  const confirm = async (action: PermissionAction, permissions: readonly Permission[], description?: string) => {
    if (testConfirm && context.extensionMode === vscode.ExtensionMode.Test) { return testConfirm(action, permissions); }
    return await vscode.window.showWarningMessage(
      'VxWorks Agent: ' + action + ' [' + permissions.join(', ') + '] — local operation.' + (description ? '\n' + description : ''),
      { modal: action !== 'write_file' && action !== 'agent_loop_run', detail: description ?? 'This operation may start/run or stop the local VxWorks QEMU target. Full Validation starts and stops its own test processes.' },
      'Allow once'
    ) === 'Allow once';
  };
  const publish = () => {
    if (!panel || !backend) { return; }
    void backend.getConsole(500).then(consoleText => panel?.webview.postMessage({
      type: 'state', state: loop?.view.active ? loop.view.backendState ?? backend.state : backend.state, console: loop ? loopConsole.read(500) : consoleText, loop: loop?.view,
      demoAgent, publicLlm: openAIConfiguration(), demo: demo?.view, result: lastResult, busy: !!demo?.view.active || busyCount > 0 || switching || !!loop?.view.active
    }));
  };
  let scheduled: NodeJS.Timeout | undefined;
  const schedule = () => {
    if (!scheduled) { scheduled = setTimeout(() => { scheduled = undefined; publish(); }, 60); }
  };
  const createBackend = (kind: string) => {
    backend = kind === 'sdk' ? new SdkBackend(context.extensionPath) : new MockBackend();
    controller = new AgentController(backend, new PermissionManager(confirm));
    provider = new MockAgentProvider(controller);
    backend.on('state', schedule);
    backend.on('console', event => {
      if (event.source === 'clear') { output.clear(); }
      else { output.append(event.text.replace(/\r/g, '')); }
      schedule();
    });
  };
  createBackend(vscode.workspace.getConfiguration('vxworksAgent').get<string>('backend', 'mock'));

  const execute = async (action: Action, lastLines?: number): Promise<unknown> => {
    if (!Object.hasOwn(ACTION_PERMISSIONS, action)) { throw new Error('Unsupported action'); }
    if (switching || loop?.view.active || demo?.view.active) { throw new Error('Wait for the active Agent Loop/backend switch'); }
    busyCount++; publish();
    try {
      const result = await controller.execute(action, lastLines);
      lastResult = result;
      if (action === 'getConsole') { output.show(true); }
      return result;
    } catch (error) {
      lastResult = { error: error instanceof Error ? error.message : String(error) };
      output.appendLine('[ERROR] ' + JSON.stringify(lastResult));
      throw error;
    } finally { busyCount--; publish(); }
  };
  const request = async (text: string) => {
    if (switching || loop?.view.active || demo?.view.active) { throw new Error('Wait for the active Agent Loop/backend switch'); }
    busyCount++; publish();
    try { lastResult = await provider.request(text); return lastResult; }
    catch (error) { lastResult = { error: String(error) }; throw error; }
    finally { busyCount--; publish(); }
  };
  const changeBackend = async () => {
    const config = vscode.workspace.getConfiguration('vxworksAgent');
    const next = config.get<string>('backend', 'mock');
    if (next === backend.state.backend || switching) { return; }
    const previous = backend.state.backend;
    try {
      if (busyCount || loop?.view.active || demo?.view.active) { throw new Error('Wait for the active operation before switching backends.'); }
      switching = true; publish();
      if (backend.state.qemu === 'Running' || backend.state.debugger !== 'Disconnected') {
        await controller.execute('stop');
      }
      await backend.dispose();
      createBackend(next);
      lastResult = await controller.execute('validateEnvironment');
    } catch (error) {
      lastResult = { error: String(error) };
      if (backend.state.backend === previous) {
        await config.update('backend', previous, vscode.ConfigurationTarget.Workspace);
      }
      void vscode.window.showErrorMessage(String(error));
    } finally { switching = false; publish(); }
  };
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('vxworksAgent.backend')) { void changeBackend(); }
  }));

  const runAgentLoop = async (input?: LoopRequest) => {
    if (busyCount || switching || loop?.view.active || demo?.view.active) { throw new Error('Another operation is active'); }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || !vscode.workspace.isTrusted) { throw new Error('Open a trusted local project first'); }
    const text = input?.text ?? await vscode.window.showInputBox({ prompt: 'Test application request; e.g. Print "Hello Agent"' });
    if (text === undefined) { return; }
    const kind = backend.state.backend;
    loopConsole.clear();
    loop = new AgentEditLoop(root, new RuleBasedAgentProvider(), controller.permissions,
      () => kind === 'sdk' ? new SdkBackend(context.extensionPath) : new MockApplicationBackend());
    loop.on('state', schedule);
    loop.on('console', event => { loopConsole.append(event.text); output.append(event.text.replace(/\r/g, '')); schedule(); });
    const result = await loop.start({ ...input, text });
    lastResult = result; publish(); return result;
  };
  const cancelAgentLoop = async () => { await loop?.cancel(); publish(); };
  const showLoopFile = async (name: string) => {
    const directory = loop?.view.evidenceDirectory;
    if (!directory) { throw new Error('Run Agent Loop first'); }
    await vscode.window.showTextDocument(vscode.Uri.file(join(directory, name)), { preview: false });
  };
  for (const [name, handler] of Object.entries({ runAgentLoop, cancelAgentLoop,
    showDiff: () => showLoopFile('diff.patch'), showEvidence: () => showLoopFile('result.json') })) {
    context.subscriptions.push(vscode.commands.registerCommand('vxworksAgent.' + name, handler));
  }
  const runDemoScenario = async () => {
    assertDemoAgentConfigured(demoAgent);
    if (busyCount || switching || loop?.view.active || demo?.view.active) { throw new Error('Another operation is active'); }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || !vscode.workspace.isTrusted) { throw new Error('Open a trusted local workspace first'); }
    demo = new DemoRunner(context.extensionPath, root, controller.permissions,
      demoAgent === 'public-llm' ? new OpenAIResponsesTransport() : undefined);
    demo.on('state', schedule);
    try { lastResult = await demo.start(); return lastResult; } finally { publish(); }
  };
  const showDemoFile = async (file: string) => {
    if (!demo?.view.evidenceDirectory) { throw new Error('Run Demo Scenario first'); }
    await vscode.window.showTextDocument(vscode.Uri.file(join(demo.view.evidenceDirectory, file)), { preview: false });
  };
  const demoHandlers = {
    demoRun: runDemoScenario,
    demoCancel: async () => { await demo?.cancel(); publish(); },
    demoDiff: () => showDemoFile('diff.patch'),
    demoEvidence: () => showDemoFile('result.json')
  };
  for (const type of Object.keys(DEMO_COMMANDS) as (keyof typeof DEMO_COMMANDS)[]) {
    context.subscriptions.push(vscode.commands.registerCommand('vxworksAgent.' + DEMO_COMMANDS[type], demoHandlers[type]));
  }
  const openPanel = () => {
    if (panel) { panel.reveal(); publish(); return; }
    panel = vscode.window.createWebviewPanel('vxworksAgent', 'VxWorks Agent', vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(join(context.extensionPath, 'media'))]
    });
    const nonce = randomBytes(24).toString('hex');
    const replacements: Record<string, string> = {
      nonce, csp: panel.webview.cspSource,
      script: panel.webview.asWebviewUri(vscode.Uri.file(join(context.extensionPath, 'media/panel.js'))).toString(),
      style: panel.webview.asWebviewUri(vscode.Uri.file(join(context.extensionPath, 'media/panel.css'))).toString()
    };
    panel.webview.html = readFileSync(join(context.extensionPath, 'media/panel.html'), 'utf8')
      .replace(/\{\{(\w+)\}\}/g, (_, key: string) => replacements[key]);
    panel.onDidDispose(() => { panel = undefined; lastRendered = undefined; });
    panel.webview.onDidReceiveMessage(async message => {
      try {
        if (message?.type === 'demoAgent') {
          if (busyCount || switching || loop?.view.active || demo?.view.active) { throw new Error('Wait for the active operation'); }
          if (!Object.hasOwn(DEMO_AGENT_OPTIONS, message.value)) { throw new Error('Unsupported Demo Agent'); }
          demoAgent = message.value; publish();
        }
        else if (message && Object.hasOwn(demoHandlers, message.type)) { await demoHandlers[message.type as keyof typeof demoHandlers](); }
        else if (message?.type === 'loopRun') { await runAgentLoop({ text: String(message.text ?? ''), expectedOutput: message.expectedOutput || undefined, scenario: message.scenario }); }
        else if (message?.type === 'loopCancel') { await cancelAgentLoop(); }
        else if (message?.type === 'loopDiff') { await showLoopFile('diff.patch'); }
        else if (message?.type === 'loopEvidence') { await showLoopFile('result.json'); }
        else if (message?.type === 'ready') { publish(); }
        else if (message?.type === 'rendered') {
          renderedLoopStatus = message.loopStatus; lastRendered = message.state; renderedValidationStatus = message.validationStatus;
        }
        else if (message?.type === 'action' && typeof message.action === 'string' && Object.hasOwn(ACTION_PERMISSIONS, message.action)) {
          await execute(message.action as Action, message.lastLines);
        } else if (message?.type === 'request' && typeof message.text === 'string') {
          await request(message.text);
        } else if (message?.type === 'backend' && ['mock', 'sdk'].includes(message.value)) {
          await vscode.workspace.getConfiguration('vxworksAgent').update('backend', message.value, vscode.ConfigurationTarget.Workspace);
        }
      } catch (error) { void vscode.window.showErrorMessage(String(error)); }
    }, undefined, context.subscriptions);
  };
  context.subscriptions.push(vscode.commands.registerCommand('vxworksAgent.openPanel', openPanel));
  for (const action of Object.keys(ACTION_PERMISSIONS) as Action[]) {
    context.subscriptions.push(vscode.commands.registerCommand('vxworksAgent.' + action, () => execute(action)));
  }
  context.subscriptions.push(vscode.commands.registerCommand('vxworksAgent.agentRequest', async (text?: string) => {
    const input = text ?? await vscode.window.showInputBox({ prompt: 'build / start / debug / run / console / stop / full validation' });
    if (input !== undefined) { return request(input); }
  }));
  cleanup = async () => {
    if (scheduled) { clearTimeout(scheduled); }
    await demo?.cancel(); await loop?.cancel(); await backend.dispose(); panel?.dispose();
  };
  if (backend.state.backend === 'sdk') {
    try { lastResult = await controller.execute('validateEnvironment'); }
    catch (error) { lastResult = { error: String(error) }; output.appendLine(String(error)); }
  }
  if (context.extensionMode === vscode.ExtensionMode.Development) { openPanel(); }
  return {
    execute, request, runAgentLoop, cancelAgentLoop, getLoopState: () => loop?.view, getRenderedLoopStatus: () => renderedLoopStatus, getState: () => ({ ...backend.state }),
    getAudit: () => controller.permissions.audit.slice(),
    getRenderedState: () => lastRendered,
    getRenderedValidationStatus: () => renderedValidationStatus,
    setTestConfirmation(handler: typeof testConfirm) {
      if (context.extensionMode !== vscode.ExtensionMode.Test) { throw new Error('Test hook unavailable'); }
      testConfirm = handler;
    }
  };
}

export async function deactivate(): Promise<void> { await cleanup?.(); cleanup = undefined; }
