import { EditProposal, LoopRequest, Plan, RepairContext } from './loop/Types';
import type { ProviderCapabilities, ProviderContext, ProviderDecision } from './ProviderContract';

/** Provider returns data only. Files, permissions, processes and validation belong to EditLoop. */
export interface AgentProvider {
  readonly id: string;
  readonly capabilities?: ProviderCapabilities;
  analyze(request: Readonly<LoopRequest>, signal: AbortSignal): Promise<Plan>;
  repair(context: Readonly<RepairContext>, signal: AbortSignal): Promise<EditProposal>;
  /** Reserved planning contract. The current fixed EditLoop does not dispatch these actions. */
  propose?(context: ProviderContext, signal: AbortSignal): Promise<ProviderDecision>;
}
