import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

export function requireWithin(root: string, file: string): string {
  const base = realpathSync(root), resolved = realpathSync(file), rel = relative(base, resolved);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) {
    throw new Error('Demo path escaped its root');
  }
  return resolved;
}
/** No-workspace fallback belongs only to the public Demo in Development mode. */
export function resolveDemoRoots(extensionPath: string, workspace: string | undefined, trusted: boolean, development: boolean) {
  if (workspace && !trusted) { throw new Error('Open a trusted local workspace first'); }
  if (!workspace && !development) { throw new Error('Open a trusted local workspace first'); }
  const baselineRoot = realpathSync(extensionPath);
  requireWithin(baselineRoot, join(baselineRoot, 'demo/controller'));
  if (workspace) { return { baselineRoot, projectRoot: workspace }; }
  const artifacts = join(baselineRoot, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  requireWithin(baselineRoot, artifacts);
  // Fresh session directory prevents reusing a user-controlled run/work path.
  const projectRoot = mkdtempSync(join(artifacts, 'demo-session-'));
  return { baselineRoot, projectRoot: requireWithin(baselineRoot, projectRoot) };
}
