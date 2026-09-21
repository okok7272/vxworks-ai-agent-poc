import type { AgentProvider } from './AgentProvider';
import type { ProviderCapabilities, ProviderContext, ProviderDecision } from './ProviderContract';
import type { EditProposal, LoopRequest, Plan, RepairContext } from './loop/Types';
import { checkAbort } from './loop/Abort';

export const COMPANY_PROVIDER_UNAVAILABLE = 'Company provider is not connected. Confirm the company API contract and data transmission scope before implementing an adapter.';

/** Offline placeholder. No transport, endpoint, authentication or model assumptions. */
export class CompanyAgentProvider implements AgentProvider {
  readonly id = 'company-placeholder';
  readonly capabilities: ProviderCapabilities = Object.freeze({
    chat: 'unknown', structuredOutput: 'unknown', toolCalling: 'unknown', mcp: 'unknown', fileSearch: 'unknown'
  });
  async analyze(_request: Readonly<LoopRequest>, signal: AbortSignal): Promise<Plan> {
    checkAbort(signal); throw new Error(COMPANY_PROVIDER_UNAVAILABLE);
  }
  async repair(_context: Readonly<RepairContext>, signal: AbortSignal): Promise<EditProposal> {
    checkAbort(signal); throw new Error(COMPANY_PROVIDER_UNAVAILABLE);
  }
  async propose(_context: ProviderContext, signal: AbortSignal): Promise<ProviderDecision> {
    checkAbort(signal);
    return { action: { kind: 'ABORT', reason: COMPANY_PROVIDER_UNAVAILABLE } };
  }
}
