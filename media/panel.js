(() => {
  const vscode = acquireVsCodeApi();
  const element = id => document.getElementById(id);
  element('backend').addEventListener('change', event => vscode.postMessage({ type: 'backend', value: event.target.value }));
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    vscode.postMessage({ type: 'action', action: button.dataset.action,
      lastLines: button.dataset.lines ? Number(button.dataset.lines) : undefined });
  }));
  element('agentForm').addEventListener('submit', event => {
    event.preventDefault();
    vscode.postMessage({ type: 'request', text: element('request').value });
  });
  for (const type of ['loopRun', 'loopCancel', 'loopDiff', 'loopEvidence']) {
    element(type).addEventListener('click', () => vscode.postMessage({ type, text: element('loopRequest').value, expectedOutput: element('loopExpected').value, scenario: element('loopScenario').value }));
  }
  for (const type of ['demoRun', 'demoCancel', 'demoDiff', 'demoEvidence']) {
    element(type).addEventListener('click', () => vscode.postMessage({ type }));
  }
  window.addEventListener('message', ({ data }) => {
    if (data.type !== 'state') return;
    const state = data.state;
    element('backend').value = state.backend;
    element('backendStatus').textContent = state.backend.toUpperCase();
    for (const key of ['sdk', 'qemu', 'vxworks', 'debugger']) element(key).textContent = state[key];
    element('notice').textContent = state.error || (data.busy ? 'Working…' : state.backend === 'mock' ? 'Mock mode — simulated results' : 'Local SDK ready for commands');
    element('console').textContent = data.console;
    element('console').scrollTop = element('console').scrollHeight;
    element('result').textContent = typeof data.result === 'string' ? data.result : JSON.stringify(data.result ?? {}, null, 2);
    document.querySelectorAll('button, select, input').forEach(control => {
      control.disabled = data.busy && !['getConsole', 'clearConsole'].includes(control.dataset.action);
    });
    const demo = data.demo;
    element('demoStatus').textContent = demo?.status ?? 'IDLE';
    element('demoResult').textContent = demo ? JSON.stringify(demo, null, 2) : 'No demo run yet. Model only.';
    element('demoCancel').disabled = !demo?.active;
    element('demoDiff').disabled = !demo?.evidenceDirectory;
    element('demoEvidence').disabled = !demo?.evidenceDirectory;
    const loop = data.loop;
    element('loopStatus').textContent = loop?.status ?? 'IDLE';
    element('loopIteration').textContent = loop?.iteration ?? 0;
    element('loopDetails').textContent = JSON.stringify({ lastError: loop?.lastError, buildResult: loop?.buildResult, runtimeResult: loop?.runtimeResult }, null, 2);
    element('loopCancel').disabled = !loop?.active;
    element('loopDiff').disabled = !loop?.evidenceDirectory;
    element('loopEvidence').disabled = !loop?.evidenceDirectory;
    vscode.postMessage({ type: 'rendered', loopStatus: loop?.status, state, validationStatus: data.result?.result?.status });
  });
  vscode.postMessage({ type: 'ready' });
})();
