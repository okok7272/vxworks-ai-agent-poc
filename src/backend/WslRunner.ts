import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';

// --exec bypasses WSL's default shell as well as Node's shell:false.
export function wslArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const distro = env.VXWORKS_WSL_DISTRO || 'Ubuntu-22.04';
  const user = env.VXWORKS_WSL_USER;
  return ['-d', distro, ...(user ? ['-u', user] : []), '--exec'];
}
export const WSL_ARGS = wslArgs();
export class WslRunner {
  spawn(command: string, args: string[] = []): ChildProcessWithoutNullStreams {
    if (process.platform !== 'win32') { throw new Error('SDK backend requires a Windows extension host and WSL2 Ubuntu-22.04.'); }
    return spawn('wsl.exe', [...wslArgs(), command, ...args], {
      shell: false, windowsHide: true, stdio: 'pipe'
    });
  }
  async capture(command: string, args: string[], timeoutMs = 15000): Promise<string> {
    const child = this.spawn(command, args);
    return new Promise((resolve, reject) => {
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('WSL command timed out: ' + command)); }, timeoutMs);
      child.stdout.setEncoding('utf8').on('data', text => { stdout += text; });
      child.stderr.setEncoding('utf8').on('data', text => { stderr += text; });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code !== 0) { reject(new Error('WSL command failed (' + code + '): ' + stderr)); }
        else { resolve(stdout.trim()); }
      });
      child.stdin.end();
    });
  }
}
