# First public upload preparation

The public candidates contain Agent code, original Demo fixtures, metadata and documentation only.
Local evidence, historical machine-specific reports, build products, vendor PDFs/binaries, portable VS Code,
private knowledge and credential file categories are excluded. No vendor material was downloaded/copied.
The offline scan reports suspected secrets without printing their values. It is heuristic, not certification
that all possible proprietary data or secrets are absent. Review the staged file list before publishing.

## Portable local paths

- Bridge SDK: Path.home() / wrsdk-vxworks7-qemu.
- Existing tests/scripts: Path.home() / vxworks-qemu-test.
- Isolated Agent applications: Path.home() / vxworks-agent-apps.
- WslRunner: default Ubuntu-22.04 distribution and default Linux user.
- Optional Windows process environment: VXWORKS_WSL_DISTRO, VXWORKS_WSL_USER. Set privately before launching VS Code.
- Five VS Code SDK tasks retain their labels/script names and select Ubuntu-22.04's default user.
  They pass a fixed Python expression via --exec to resolve home and exec the original script.

The original SDK directories, kernel/BSP and Linux scripts are untouched. Existing private scripts may themselves
be environment-specific; this project does not rewrite them. This portability change does not claim support
for arbitrary SDK/BSP layouts. Set up those local dependencies separately before selecting SDK mode.

Quick checks performed for publication preparation: TypeScript compile, two WSL/task contract tests,
Python syntax and home/path assignment checks. No SDK task/bridge, QEMU, wrdbg, RTP or old suite was executed.

## Suggested GitHub metadata

- Repository name: vxworks-ai-agent-poc
- Description: Public VxWorks AI agent PoC with permission-gated edit loops, deterministic controller demos, and SDK/QEMU backend support.
- First commit message: feat: prepare public VxWorks AI agent provider and demo knowledge

Create an empty repository in your GitHub account, without initial README/.gitignore/license files.
Choose the visibility yourself. No remote/repository is created by this preparation work.
The project owner should decide the distribution license before release; no license was invented here.

After reviewing staged files and creating the repository:

~~~sh
git diff --cached --stat
git commit -m "feat: prepare public VxWorks AI agent provider and demo knowledge"
git remote add origin https://github.com/YOUR_ACCOUNT/vxworks-ai-agent-poc.git
git push -u origin main
~~~

Use your actual account/URL. If Git identity or authentication is missing, configure it yourself using your
normal approved workflow; this task does not change credentials or account settings. No force push is needed.
