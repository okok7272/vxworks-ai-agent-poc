import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { requireWithin } from './DemoRoots';
import type { ProviderContext, ProviderDecision } from '../agent/ProviderContract';
import type { EditProposal } from '../agent/loop/Types';

export const DEMO = Object.freeze({ id: 'demo-controller', title: 'Demo Controller', agent: 'Deterministic Demo Agent', scenario: 'UDP Timeout Watchdog Recovery' });
export const EXPECTED = 'communication state recovered';
export const FIX = '    s->watchdog_ms = now;';
export const DEFECT = '    /* DEMO DEFECT: watchdog timestamp not refreshed */';
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export function readDemo(root: string, path: string): string {
  const base = requireWithin(root, join(root, 'demo/controller'));
  const file = requireWithin(base, join(base, path));
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (text.length > 32768) { throw new Error('Demo input exceeds context limit'); }
  return text;
}
export function seedDefect(source: string): string {
  if (source.split(FIX).length !== 2 || source.includes(DEFECT)) { throw new Error('Unrecognized demo baseline; refusing to guess'); }
  return source.replace(FIX, DEFECT);
}
export interface DemoContext extends ProviderContext { readonly controller: typeof DEMO }
export function demoContext(root: string, source: string, request: string, previous?: DemoContext): DemoContext {
  const selections = [
    ['ARCHITECTURE', (line: string) => /Logical |Data flow|watchdog is/.test(line)],
    ['NETWORK_SPEC', (line: string) => /After |A valid|and increments/.test(line)],
    ['REQUIREMENTS', (line: string) => /REQ-0[2345]/.test(line)]
  ] as const;
  return { controller: DEMO, request: { text: request }, sources: [{ relativePath: 'main.c', content: source, hash: digest(source) }],
    history: previous?.history ?? [], compiler: previous?.compiler, runtime: previous?.runtime,
    knowledge: selections.map(([name, select]) => ({ id: name, title: name, source: 'demo/controller/docs/' + name + '.md',
      version: '1', controller: DEMO.id, documentType: 'controller', confidence: 'VERIFIED',
      content: readDemo(root, 'docs/' + name + '.md').split('\n').filter(select).join('\n') })) };
}
export interface DemoResponse {
  analysis: string; targetFile: 'main.c'; expectation: typeof EXPECTED; decision: ProviderDecision;
}
/** Runtime response boundary: exact keys/action/file/allowed patch, not just a TS cast. */
export function adaptResponse(value: unknown, current: string): EditProposal | 'COMPLETE' {
  if (!value || typeof value !== 'object') { throw new Error('Invalid Demo response'); }
  const r = value as DemoResponse;
  if (Object.keys(r).some(k => !['analysis', 'targetFile', 'expectation', 'decision'].includes(k)) ||
      typeof r.analysis !== 'string' || !r.analysis || r.targetFile !== 'main.c' || r.expectation !== EXPECTED) { throw new Error('Invalid Demo response scope'); }
  const action = r.decision?.action;
  if (action?.kind === 'ABORT') { throw new Error('Provider ABORT: ' + action.reason); }
  if (action?.kind === 'COMPLETE') {
    const assessment = action.assessment;
    if (!assessment || !['PASS', 'FAIL', 'UNKNOWN'].includes(assessment.status) ||
        typeof assessment.reason !== 'string' || !Array.isArray(assessment.evidenceIds) ||
        !assessment.evidenceIds.every(id => typeof id === 'string')) { throw new Error('Invalid COMPLETE assessment'); }
    return 'COMPLETE'; // Advisory only: host verifies separately.
  }
  if (action?.kind !== 'EDIT' || typeof action.proposal?.reason !== 'string' || !action.proposal.reason ||
      !current.includes(DEFECT) || action.proposal.source !== current.replace(DEFECT, FIX)) { throw new Error('Unsupported Demo edit/action'); }
  return { source: action.proposal.source, reason: action.proposal.reason };
}
