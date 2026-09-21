import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wslArgs } from '../backend/WslRunner';
test('WSL defaults to distribution user; explicit private environment overrides remain argument arrays', () => {
  assert.deepEqual(wslArgs({}), ['-d', 'Ubuntu-22.04', '--exec']);
  assert.deepEqual(wslArgs({ VXWORKS_WSL_DISTRO: 'Private Linux', VXWORKS_WSL_USER: 'test-user' }),
    ['-d', 'Private Linux', '-u', 'test-user', '--exec']);
});
test('all five original SDK tasks resolve script locations from Linux home without fixed user paths', () => {
  const tasks = JSON.parse(readFileSync('.vscode/tasks.json', 'utf8')).tasks.filter((t: any) => t.command === 'wsl.exe');
  assert.equal(tasks.length, 5);
  for (const task of tasks) {
    assert.ok(!task.args.includes('-u')); assert.ok(task.args.includes('--exec'));
    assert.match(task.args.at(-1), /pathlib\.Path\.home\(\)/);
    assert.ok(!task.args.join(' ').includes('/home/'));
    assert.match(task.args.at(-1), /os\.execv/);
  }
});
