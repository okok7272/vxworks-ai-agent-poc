// Offline structure/publication-candidate check. Never stages, commits or contacts a remote.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const schema = JSON.parse(fs.readFileSync('knowledge/manifest.schema.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('knowledge/manifest.example.json', 'utf8'));
assert.equal(manifest.schemaVersion, 1);
const definition = schema.properties.entries.items;
const ids = new Set();
for (const entry of manifest.entries) {
  for (const key of definition.required) assert.ok(Object.hasOwn(entry, key), key);
  for (const key of Object.keys(entry)) assert.ok(Object.hasOwn(definition.properties, key), key);
  for (const key of ['documentType', 'confidence', 'redistribution']) assert.ok(definition.properties[key].enum.includes(entry[key]));
  assert.ok(!ids.has(entry.id)); ids.add(entry.id);
  assert.equal(entry.controller, 'demo-controller');
  assert.ok(new RegExp(definition.properties.path.pattern).test(entry.path));
  assert.ok(fs.statSync(entry.path).isFile());
  assert.equal(entry.redistribution, 'original-public');
}
for (const file of ['README.md','docs/ARCHITECTURE.md','docs/NETWORK_SPEC.md','docs/REQUIREMENTS.md','src/main.c','tests/test_controller.c']) {
  assert.ok(fs.statSync(path.join('demo/controller', file)).isFile());
}
const git = cp.spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', windowsHide: true });
const isGit = git.status === 0 && git.stdout.trim() === 'true';
const listing = isGit
  ? cp.execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard'], { encoding: 'utf8', windowsHide: true })
  : cp.execFileSync('rg', ['--files', '--hidden', '--no-require-git', '-g', '!.git/**'], { encoding: 'utf8', windowsHide: true });
const files = [...new Set(listing.trim().split(/\r?\n/))].filter(Boolean);
const findings = [];
for (const file of files) {
  const normalized = file.replace(/\\/g, '/');
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) { findings.push({ file, type: 'symlink-review' }); continue; }
  if (/(?:^|\/)(?:\.env(?:\..*)?|CompanyKnowledge|company-knowledge|node_modules|\.vscode-test|artifacts|dist|wrsdk[^/]*)($|\/)|\.(pdf|exe|dll|zip|7z|gz|tar|bin|elf|so|a|vxe|o|obj|qcow2|vmdk|pem|key|pfx|p12|keystore|log)$/i.test(normalized)) findings.push({ file, type: 'excluded-category-in-candidates' });
  if (stat.size > 1024 * 1024) { findings.push({ file, type: 'large-file-review', bytes: stat.size }); continue; }
  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) { findings.push({ file, type: 'binary-review' }); continue; }
  const text = buffer.toString('utf8');
  // Never include matched secret values in reports.
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_]{16,}|(?:api[_-]?key|password|token|secret)\s*[:=]\s*["'][^"'\s]{8,}["']/i.test(text)) findings.push({ file, type: 'potential-secret-review' });
  if (/(?:C:\\Users\\|\/home\/[A-Za-z0-9_.-]+\/)/.test(text)) findings.push({ file, type: 'machine-specific-path-review' });
}
const report = { structure: 'PASS', manifestEntries: ids.size, gitRepository: isGit,
  trackedInspection: isGit ? 'tracked and untracked candidates' : 'unavailable: no Git repository; inspected ignore-filtered filesystem candidates',
  candidateFiles: files, findings, publicationReady: isGit && findings.length === 0,
  commit: null, push: 'NOT PERFORMED', note: 'Heuristic review only; no credentials printed or network used.' };
fs.mkdirSync('artifacts/public-poc', { recursive: true });
fs.writeFileSync('artifacts/public-poc/inspection.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ structure: report.structure, manifestEntries: ids.size, gitRepository: isGit, candidateCount: files.length, findings, push: report.push }, null, 2));
