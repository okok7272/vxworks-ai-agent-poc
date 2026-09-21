// Read-only artifact check; does not load the VS Code extension, spawn WSL or run QEMU.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const checked = new Set();
function required(relative) {
  assert.ok(fs.statSync(path.join(root, relative)).isFile(), 'Missing runtime file: ' + relative);
  checked.add(relative);
}
function visit(relative) {
  if (checked.has(relative)) return;
  required(relative);
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  for (const match of source.matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
    const next = path.normalize(path.join(path.dirname(relative), match[1] + '.js')).replaceAll('\\', '/');
    visit(next);
  }
}
visit(manifest.main.replace(/^\.\//, ''));
for (const file of ['package.json', 'scripts/sdk_bridge.py', 'media/panel.html', 'media/panel.js', 'media/panel.css']) required(file);
const ignore = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8').split(/\r?\n/);
for (const entry of ['.vscode-test/**', 'src/**', 'tools/**', 'artifacts/**', 'dist/test/**']) {
  assert.ok(ignore.includes(entry), 'Missing VSIX exclusion: ' + entry);
}
for (const file of checked) {
  assert.ok(!file.startsWith('dist/test/'), 'Test module imported by product: ' + file);
}
assert.equal(manifest.contributes.configuration.properties['vxworksAgent.backend'].default, 'mock');
const tasks = JSON.parse(fs.readFileSync(path.join(root, '.vscode/tasks.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(tasks.tasks.filter(task => task.command === 'wsl.exe').length, 5);
assert.ok(tasks.tasks.some(task => task.label === 'VxWorks Agent: Compile Extension'));
console.log(JSON.stringify({ status: 'PASS', files: [...checked].sort(),
  originalWslTasks: 5, compiledTestsExcluded: true, portableVscodeExcluded: true,
  note: 'Static runtime inventory; no VSIX build/install or SDK integration test performed.' }, null, 2));
