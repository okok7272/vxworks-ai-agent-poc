import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDemoRoots, requireWithin } from '../demo/DemoRoots';
import { readDemo } from '../demo/DemoAdapters';
function fixture() {
  mkdirSync('artifacts', { recursive: true });
  const root = mkdtempSync(join(process.cwd(), 'artifacts', 'root-contract-'));
  mkdirSync(join(root, 'demo/controller/src'), { recursive: true });
  writeFileSync(join(root, 'demo/controller/src/main.c'), 'read-only baseline');
  return root;
}
test('no folder Development fallback uses fresh internal project roots and preserves baseline', () => {
  const root = fixture();
  const a = resolveDemoRoots(root, undefined, false, true), b = resolveDemoRoots(root, undefined, true, true);
  assert.equal(a.baselineRoot, root); assert.notEqual(a.projectRoot, b.projectRoot);
  assert.equal(requireWithin(root, a.projectRoot), a.projectRoot);
  assert.equal(readDemo(root, 'src/main.c'), 'read-only baseline');
  assert.throws(() => readDemo(root, '../../../package.json'));
});
test('production missing workspace and untrusted existing workspace remain blocked', () => {
  const root = fixture();
  assert.throws(() => resolveDemoRoots(root, undefined, true, false), /trusted/);
  assert.throws(() => resolveDemoRoots(root, process.cwd(), false, true), /trusted/);
  assert.equal(resolveDemoRoots(root, process.cwd(), true, false).projectRoot, process.cwd());
});
test('junction escapes through controller or artifact roots are rejected', () => {
  const outside = fixture(), root = fixture();
  symlinkSync(outside, join(root, 'artifacts'), 'junction');
  assert.throws(() => resolveDemoRoots(root, undefined, true, true), /escaped/);
  symlinkSync(outside, join(root, 'demo/controller/external'), 'junction');
  assert.throws(() => readDemo(root, 'external/demo/controller/src/main.c'), /escaped/);
  const other = fixture();
  symlinkSync(join(outside, 'demo/controller'), join(other, 'linked-controller'), 'junction');
  assert.throws(() => requireWithin(other, join(other, 'linked-controller')), /escaped/);
});
test('extension uses fallback only inside Demo handler and retains general loop trust/permissions', () => {
  const source = readFileSync('src/extension.ts', 'utf8');
  const demo = source.slice(source.indexOf('const runDemoScenario ='), source.indexOf('const showDemoFile ='));
  assert.ok(demo.includes('resolveDemoRoots(')); assert.ok(demo.includes('vscode.ExtensionMode.Development'));
  assert.ok(demo.includes('controller.permissions'));
  const general = source.slice(source.indexOf('const runAgentLoop ='), source.indexOf('const cancelAgentLoop ='));
  assert.ok(general.includes('!root || !vscode.workspace.isTrusted')); assert.ok(!general.includes('resolveDemoRoots'));
});
