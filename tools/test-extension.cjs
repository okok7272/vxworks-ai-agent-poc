const { runTests } = require('@vscode/test-electron');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '..');
  const workspace = path.join(root, '.vscode-test', 'workspace');
  fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({
    'vxworksAgent.backend': 'mock', 'security.workspace.trust.enabled': false,
    'workbench.startupEditor': 'none', 'telemetry.telemetryLevel': 'off',
    'update.mode': 'none', 'extensions.autoUpdate': false,
    'window.restoreWindows': 'none'
  }, null, 2));
  const executable = process.env.VSCODE_EXECUTABLE;
  if (executable && !fs.existsSync(executable)) throw new Error('VS Code not found: ' + executable);
  await runTests({
    vscodeExecutablePath: executable,
    version: '1.95.3',
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'dist', 'test', process.env.VXWORKS_LOOP_TEST ? 'agent-loop.extension.js' : 'extension.integration.js'),
    launchArgs: [
      workspace, '--new-window', '--disable-extensions', '--skip-welcome',
      '--skip-release-notes', '--disable-workspace-trust',
      '--user-data-dir=' + path.join(root, '.vscode-test', 'user-data'),
      '--extensions-dir=' + path.join(root, '.vscode-test', 'extensions')
    ]
  });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
