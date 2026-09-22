// One opt-in request, no source/context files, no tools. Never print raw responses/errors.
const { openAIConfiguration, openAISmoke } = require('../dist/agent/llm/OpenAIResponsesTransport');
if (openAIConfiguration().status !== 'READY') {
  console.log('SKIPPED: Public LLM NOT CONFIGURED; no request sent');
} else {
  openAISmoke().then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error('FAIL: OpenAI smoke request or structured validation failed; no tools executed');
    process.exitCode = 1;
  });
}
