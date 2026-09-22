import type { LLMTransport } from './LLMTransport';
import { OpenAIResponsesTransport, openAIConfiguration, openAISmoke } from './OpenAIResponsesTransport';

export const CONNECTION_COMMAND = 'vxworksAgent.testPublicLlmConnection';
export interface ConnectionResult {
  api: 'CONNECTED' | 'FAILED'; provider: 'OpenAI'; model: string;
  structuredValidation?: 'PASS'; httpStatus?: number; error?: string;
}
/** Explicit user action only. No tools, backend, files, evidence or retries. */
export async function testPublicLlmConnection(signal: AbortSignal,
  config = openAIConfiguration(), createTransport: () => LLMTransport = () => new OpenAIResponsesTransport()): Promise<ConnectionResult> {
  const base = { provider: 'OpenAI' as const, model: config.model };
  if (config.status !== 'READY') { return { ...base, api: 'FAILED', error: 'NOT CONFIGURED' }; }
  try {
    await openAISmoke(createTransport(), signal);
    return { ...base, api: 'CONNECTED', structuredValidation: 'PASS' };
  } catch (error) {
    // Allow only a numeric HTTP status out; never forward an exception, cause or raw response.
    const status = error instanceof Error ? /^OpenAI HTTP ([1-5][0-9]{2})$/.exec(error.message) : null;
    return { ...base, api: 'FAILED', ...(status ? { httpStatus: Number(status[1]) } : {}),
      error: status ? 'OpenAI request rejected' : 'Connection or structured validation failed' };
  }
}
