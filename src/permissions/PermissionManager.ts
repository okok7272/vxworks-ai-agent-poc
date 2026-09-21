import { Action } from '../backend/VxWorksBackend';

export type Permission = 'build' | 'clean' | 'debug_start' | 'debug_stop' | 'console_read' | 'target_run' | 'target_stop' | 'write_file';
export type PermissionAction = Action | 'write_file' | 'agent_loop_run';
export interface PermissionContext { description?: string; signal?: AbortSignal }
export const POLICY: Readonly<Record<Permission, 'AUTO' | 'ASK'>> = Object.freeze({
  build: 'AUTO', clean: 'AUTO', debug_start: 'AUTO', debug_stop: 'AUTO', console_read: 'AUTO',
  target_run: 'ASK', target_stop: 'ASK', write_file: 'ASK'
});
export const ACTION_PERMISSIONS: Readonly<Record<Action, readonly Permission[]>> = Object.freeze({
  validateEnvironment: ['console_read'], build: ['build'], clean: ['clean'],
  debugStart: ['debug_start'], debugStop: ['debug_stop'], getConsole: ['console_read'],
  clearConsole: ['console_read'], startQemu: ['target_run'], run: ['target_run'],
  stop: ['target_stop'], fullValidation: ['build', 'target_run', 'target_stop']
});
export class PermissionDenied extends Error {}
export class PermissionManager {
  readonly audit: Array<{ action: PermissionAction; permissions: readonly Permission[]; allowed: boolean; at: string; description?: string }> = [];
  constructor(private readonly confirm: (action: PermissionAction, permissions: readonly Permission[], description?: string) => Promise<boolean>) {}
  async authorize(action: PermissionAction, context: PermissionContext = {}): Promise<void> {
    const permissions: readonly Permission[] | undefined = action === 'write_file' ? ['write_file'] :
      action === 'agent_loop_run' ? ['target_run', 'target_stop'] :
      Object.hasOwn(ACTION_PERMISSIONS, action) ? ACTION_PERMISSIONS[action as Action] : undefined;
    if (!permissions) { throw new PermissionDenied('Unsupported action: ' + action); }
    const asked = permissions.filter(permission => POLICY[permission] === 'ASK');
    let allowed = false;
    try {
      if (context.signal?.aborted) { throw new PermissionDenied('Permission request cancelled'); }
      if (!asked.length) { allowed = true; }
      else {
        const decision = this.confirm(action, asked, context.description);
        allowed = context.signal ? await new Promise<boolean>((resolve, reject) => {
          const abort = () => reject(new PermissionDenied('Permission request cancelled'));
          context.signal!.addEventListener('abort', abort, { once: true });
          if (context.signal!.aborted) { abort(); }
          decision.then(resolve, reject).finally(() => context.signal!.removeEventListener('abort', abort));
        }) : await decision;
      }
      if (context.signal?.aborted) { allowed = false; throw new PermissionDenied('Permission request cancelled'); }
    } finally { this.audit.push({ action, permissions, allowed, at: new Date().toISOString(), description: context.description }); }
    if (!allowed) { throw new PermissionDenied('Permission denied: ' + action); }
  }
}
