export type DemoAgentSelection = 'deterministic' | 'public-llm';
export const DEMO_AGENT_OPTIONS = { deterministic: 'Deterministic Demo Agent', 'public-llm': 'Public LLM' } as const;
export function assertDemoAgentConfigured(agent: DemoAgentSelection): void {
  if (agent !== 'deterministic') { throw new Error('Public LLM: NOT CONFIGURED. No external connection attempted.'); }
}
