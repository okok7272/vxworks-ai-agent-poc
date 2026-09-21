import { Action, VxWorksBackend } from '../backend/VxWorksBackend';
import { PermissionManager } from '../permissions/PermissionManager';

export class AgentController {
  private busy = false;
  constructor(readonly backend: VxWorksBackend, readonly permissions: PermissionManager) {}
  async execute(action: Action, lastLines?: number): Promise<unknown> {
    const readonlyAction = action === 'getConsole' || action === 'clearConsole';
    if (this.busy && !readonlyAction) { throw new Error('Another operation is running. Wait for its result.'); }
    if (!readonlyAction) { this.busy = true; }
    try {
      await this.permissions.authorize(action);
      if (action === 'getConsole') { return await this.backend.getConsole(lastLines); }
      return await this.backend[action]();
    } finally { if (!readonlyAction) { this.busy = false; } }
  }
}
