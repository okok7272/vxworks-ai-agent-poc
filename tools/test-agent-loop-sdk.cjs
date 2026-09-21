const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AgentEditLoop } = require('../dist/agent/loop/AgentEditLoop');
const { RuleBasedAgentProvider } = require('../dist/agent/RuleBasedAgentProvider');
const { PermissionManager } = require('../dist/permissions/PermissionManager');
const { SdkBackend } = require('../dist/backend/SdkBackend');
const { WslRunner } = require('../dist/backend/WslRunner');
const root = path.resolve(__dirname, '..');
const runner = new WslRunner();
const reports = [];
async function run(name, provider, trigger) {
  const backend = new SdkBackend(root);
  const loop = new AgentEditLoop(root, provider, new PermissionManager(async () => true), () => backend);
  const pids = new Set();
  let cancelled = false;
  backend.on('state', state => {
    for (const key of ['qemuPid', 'debuggerPid', 'buildPid']) if (state[key]) pids.add(state[key]);
    if (trigger === 'build' && state.buildPid && !cancelled) { cancelled = true; void loop.cancel(); }
  });
  backend.on('console', event => {
    if (trigger === 'runtime' && event.source === 'wrdbg' && event.text.includes('Starting program:') && !cancelled) {
      cancelled = true; void loop.cancel();
    }
  });
  loop.on('state', view => {
    if (view.status !== run.last) { console.log(name + ': ' + view.status + ' iteration ' + view.iteration); run.last = view.status; }
  });
  const result = await loop.start({ text: 'Print "Hello Agent"', scenario: 'combined' });
  reports.push({ name, result, ownedPids: [...pids] });
  fs.mkdirSync(path.join(root, 'artifacts', 'agent-loop-implementation'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts', 'agent-loop-implementation', 'sdk-tests.json'), JSON.stringify(reports, null, 2));
  assert.equal(result.status, trigger ? 'CANCELLED' : 'PASS', result.failureReason);
  assert.equal(result.cleanup, 'complete', result.cleanupError);
  const alive = await runner.capture('/usr/bin/python3', ['-c', 'import os,sys,json; print(json.dumps([p for p in map(int,sys.argv[1:]) if os.path.exists("/proc/%d"%p)]))', ...[...pids].map(String)]);
  assert.deepEqual(JSON.parse(alive), [], 'owned processes survived cleanup');
  console.log(name + ': ' + result.status + ' evidence ' + result.evidenceDirectory);
  return result;
}
async function main() {
  const result = await run('combined SDK repair', new RuleBasedAgentProvider());
  assert.equal(result.buildAttempts, 3); assert.equal(result.runtimeAttempts, 2);
  assert.equal(result.actualOutput.trim(), 'Hello Agent');
  const fixture = source => ({ id: 'cancellation-fixture', analyze: async () => ({ source, reason: 'Owned process cancellation test', analysis: 'Cancellation fixture', expectedOutput: 'Hello Agent' }), repair: async () => { throw new Error('Not a repair test'); } });
  const large = '#include <stdio.h>\n' + Array.from({ length: 1800 }, (_, i) => 'int f' + i + '(int x){return x*' + i + '+1;}').join('\n') + '\nint main(void){puts("Hello Agent");return 0;}\n';
  await run('cancel real compiler', fixture(large), 'build');
  await run('cancel running RTP', fixture('int main(void){volatile unsigned long n=0;for(;;){n++;}}\n'), 'runtime');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
