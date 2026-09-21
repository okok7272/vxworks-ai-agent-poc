import { AgentProvider } from './AgentProvider';
import { checkAbort } from './loop/Abort';
import { EditProposal, LoopRequest, Plan, RepairContext } from './loop/Types';

export function cString(value: string): string {
  // Printable ASCII is intentional for this first deterministic test application.
  if (!value || value.length > 160 || !/^[\x20-\x7e]+$/.test(value) || value.includes('%')) {
    throw new Error('Expected output must be 1–160 printable ASCII characters without printf format markers (%).');
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
export class RuleBasedAgentProvider implements AgentProvider {
  readonly id = 'rule-based-test-v1';
  async analyze(request: LoopRequest, signal: AbortSignal): Promise<Plan> {
    checkAbort(signal);
    if (!request.text.trim() || request.text.length > 4000) { throw new Error('Provide a request of 1–4000 characters.'); }
    const expectedOutput = request.expectedOutput ?? request.text.match(/"([^"]+)"/)?.[1] ?? 'Hello Agent';
    const target = cString(expectedOutput);
    const scenario = request.scenario ?? 'combined';
    if (!['compile', 'runtime', 'combined'].includes(scenario)) { throw new Error('Unsupported test scenario'); }
    const initialOutput = scenario === 'compile' ? target : 'Unexpected Agent';
    const statement = scenario === 'runtime' ? 'printf("' + initialOutput + '\\n");' : 'printf(“' + initialOutput + '\\n”)';
    return {
      expectedOutput,
      source: '#include <stdio.h>\nint main(void)\n{\n    ' + statement + '\n    return 0;\n}\n',
      analysis: 'Create a separate single-file C test application. Demonstrate ' + scenario + ' repair from an intentionally faulty baseline.',
      reason: 'Seed isolated ' + scenario + ' fixture for request: ' + request.text
    };
  }
  async repair(context: RepairContext, signal: AbortSignal): Promise<EditProposal> {
    checkAbort(signal);
    if (context.kind === 'compile') {
      if (!/error:/i.test(context.diagnostic)) { throw new Error('No compiler diagnostic to repair'); }
      const source = context.source.replace(/[“”]/g, '"').replace(/(printf\([^\n]*\))\s*\n/g, '$1;\n');
      if (source === context.source) { throw new Error('Rule provider cannot repair this compiler diagnostic'); }
      return { source, reason: 'Compiler reported an error. Replace typographic quotes with C quotes and terminate printf with a semicolon.' };
    }
    const value = cString(context.expectedOutput);
    const source = context.source.replace(/printf\("(?:\\.|[^"\\])*"\);/, () => 'printf("' + value + '\\n");');
    if (source === context.source) { throw new Error('Rule provider cannot repair this runtime mismatch'); }
    return { source, reason: 'Actual output ' + JSON.stringify(context.actualOutput.trim()) +
      ' differs from expected ' + JSON.stringify(context.expectedOutput) + '; change only the printf string.' };
  }
}
