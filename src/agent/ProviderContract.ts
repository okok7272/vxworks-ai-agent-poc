import type { EditProposal, Iteration, LoopRequest } from './loop/Types';

/** Descriptive metadata only: capability support never grants execution permission. */
export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown';
export type ProviderCapabilities = Readonly<Partial<Record<
  'chat' | 'structuredOutput' | 'toolCalling' | 'mcp' | 'fileSearch', CapabilitySupport>>>;

/** Selected excerpts only; retrieval and trust decisions belong to the host. */
export interface KnowledgeContextEntry {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly version: string;
  readonly controller: string | null;
  readonly documentType: 'vendor' | 'hardware' | 'controller' | 'source' | 'test' | 'log';
  readonly confidence: 'VERIFIED' | 'INFERRED' | 'UNKNOWN';
  readonly content: string;
}

/** Data-only snapshot assembled by the host; never backend handles or credentials. */
export interface ProviderContext {
  readonly knowledge?: readonly KnowledgeContextEntry[];
  readonly request: Readonly<LoopRequest>;
  readonly sources: readonly Readonly<{ relativePath: string; content: string; hash: string }>[];
  readonly compiler?: Readonly<{ stdout: string; stderr: string; exitCode: number | null }>;
  readonly runtime?: Readonly<{ console: string; actualOutput: string; completed: boolean }>;
  readonly history: readonly Readonly<Pick<Iteration, 'number' | 'reason' | 'sourceHash' | 'diff' | 'validation'>>[];
}

/** Advisory assessment. Only host evidence can establish final PASS/FAIL. */
export interface ProviderAssessment {
  readonly status: 'PASS' | 'FAIL' | 'UNKNOWN';
  readonly reason: string;
  readonly evidenceIds: readonly string[];
}

/** Future planning vocabulary, not an executable tool dispatch interface. */
export type ProviderAction =
  | { readonly kind: 'ANALYZE'; readonly reason: string }
  | { readonly kind: 'READ'; readonly relativePath: string }
  | { readonly kind: 'SEARCH'; readonly query: string; readonly relativePaths: readonly string[] }
  | { readonly kind: 'EDIT'; readonly proposal: Readonly<EditProposal> }
  | { readonly kind: 'BUILD' | 'RUN'; readonly reason: string }
  | { readonly kind: 'VALIDATE'; readonly expectedOutput: string }
  | { readonly kind: 'COMPLETE'; readonly assessment: ProviderAssessment }
  | { readonly kind: 'ABORT'; readonly reason: string };

export interface ProviderDecision {
  readonly action: ProviderAction;
  readonly assessment?: ProviderAssessment;
}
