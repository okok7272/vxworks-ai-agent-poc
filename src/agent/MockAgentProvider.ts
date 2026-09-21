import { Action } from '../backend/VxWorksBackend';
import { AgentController } from './AgentController';

// Deterministic provider retained for offline development; never runs arbitrary shell text.
export class MockAgentProvider {
  constructor(private readonly controller: AgentController) {}
  async request(text: string): Promise<unknown> {
    const commands: Record<string, Action> = {
      validate: 'validateEnvironment', build: 'build', clean: 'clean', start: 'startQemu',
      stop: 'stop', debug: 'debugStart', 'debug stop': 'debugStop', run: 'run',
      console: 'getConsole', 'clear console': 'clearConsole', 'full validation': 'fullValidation',
      '빌드': 'build', '실행': 'run', '콘솔': 'getConsole', '검증': 'validateEnvironment'
    };
    const action = commands[text.trim().toLowerCase()];
    if (!action) { throw new Error('Supported requests: ' + Object.keys(commands).join(', ')); }
    return this.controller.execute(action);
  }
}
