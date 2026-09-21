#!/usr/bin/env python3
"""JSON-lines bridge. Executes only the existing local QEMU test scripts.

The Windows extension owns this process; EOF terminates only its child tree.
No SDK, build script, boot script, or debugger script is rewritten.
"""
import codecs
import datetime
import fcntl
import json
import os
import pathlib
import pty
import queue
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import tty
import shutil
import shlex
from application_store import ApplicationStore

SDK = pathlib.Path.home() / "wrsdk-vxworks7-qemu"
ROOT = pathlib.Path.home() / "vxworks-qemu-test"
SCRIPTS = ROOT / "scripts"
KERNEL = SDK / "vxsdk/bsps/itl_generic_2_0_3_1/vxWorks"
BINARY = ROOT / "bin/helloworld.vxe"
BOOT_PATTERN = re.compile(r"(?:^|[\r\n])(?:-> ?|\[vxWorks \*\]# ?)")
PROMPT = re.compile(r"\(wrdbg\) ?")
write_lock = threading.Lock()
closing = threading.Event()


def emit(message):
    with write_lock:
        try:
            sys.stdout.write(json.dumps(message, ensure_ascii=True) + "\n")
            sys.stdout.flush()
        except (BrokenPipeError, OSError):
            closing.set()


def identity(pid):
    try:
        return pathlib.Path("/proc/%s/stat" % pid).read_text().rsplit(")", 1)[1].split()[19]
    except (OSError, IndexError):
        return None


def descendants(pid):
    result = []
    try:
        children = pathlib.Path("/proc/%s/task/%s/children" % (pid, pid)).read_text().split()
        for child in children:
            child = int(child)
            result.extend(descendants(child))
            result.append((child, identity(child)))
    except OSError:
        pass
    return result


def terminate_owned(proc):
    # Capture descendants before their parent exits/reparents. Never use pkill.
    children = descendants(proc.pid)
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    for pid, start in children:
        if start is not None and identity(pid) == start:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait(timeout=3)
    for pid, start in children:
        if start is not None and identity(pid) == start:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


class Terminal:
    def __init__(self, owner, name, command, env=None, cwd=None):
        self.owner, self.name = owner, name
        self.condition = threading.Condition()
        self.buffer = ""
        self.closed = False
        master, slave = pty.openpty()
        tty.setraw(slave)
        self.master = master
        try:
            self.proc = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave,
                                         start_new_session=True, env=dict(env or os.environ, TERM="dumb"), cwd=cwd)
        except Exception:
            os.close(master)
            raise
        finally:
            os.close(slave)
        self.thread = threading.Thread(target=self.read, daemon=True)
        self.thread.start()

    def read(self):
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        try:
            while True:
                data = os.read(self.master, 65536)
                if not data:
                    break
                text = decoder.decode(data)
                with self.condition:
                    # Keep cursor stable for a request; operations are serialized.
                    self.buffer += text
                    self.condition.notify_all()
                self.owner.console(self.name, "pty", text)
        except OSError:
            pass
        finally:
            with self.condition:
                self.closed = True
                self.condition.notify_all()
            self.owner.exited(self)

    def mark(self):
        with self.condition:
            # Prior transcript is already persisted; only retain current command data.
            self.buffer = ""
            return 0

    def send(self, command):
        if "\n" in command or "\r" in command:
            raise ValueError("Only a single allowlisted debugger/console command is accepted")
        self.owner.console(self.name, "input", "\n[INPUT] " + command + "\n")
        os.write(self.master, (command + "\n").encode())

    def expect(self, pattern, cursor=0, timeout=60):
        deadline = time.monotonic() + timeout
        with self.condition:
            while True:
                text = self.buffer[cursor:]
                if pattern.search(text):
                    return text
                if self.closed or closing.is_set():
                    raise RuntimeError(self.name + " closed before expected prompt:\n" + text[-4000:])
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError(self.name + " prompt timeout:\n" + text[-4000:])
                self.condition.wait(min(remaining, 0.25))

    def stop(self):
        terminate_owned(self.proc)
        self.thread.join(timeout=2)
        try:
            os.close(self.master)
        except OSError:
            pass


class Backend:
    def __init__(self):
        self.state = dict(backend="sdk", sdk="Unknown", qemu="Stopped", vxworks="Stopped", debugger="Disconnected")
        self.qemu = None
        self.debugger = None
        self.capture = None
        self.applications = ApplicationStore()
        self.sdk_env = None
        self.capture_lock = threading.Lock()
        self.operation_lock = threading.RLock()
        self.lock_file = None
        self.log_lock = threading.Lock()
        self.log_dir = ROOT / "logs" / ("extension-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + str(os.getpid()))
        # Logs are created only after the existing test root has been verified.

    def update(self, **values):
        self.state.update(values)
        emit(dict(event="state", data=self.state.copy()))
        return self.state.copy()

    def console(self, source, stream, text):
        emit(dict(event="console", data=dict(source=source, stream=stream, text=text)))
        if ROOT.is_dir():
            with self.log_lock:
                self.log_dir.mkdir(parents=True, exist_ok=True)
                with (self.log_dir / (source + ".log")).open("a", encoding="utf-8") as log:
                    log.write(text.replace("\r", ""))

    def exited(self, terminal):
        if terminal is self.qemu:
            self.update(qemu="Stopped", vxworks="Stopped", qemuPid=None)
        elif terminal is self.debugger:
            self.update(debugger="Disconnected", debuggerPid=None)

    def acquire(self):
        if self.lock_file:
            return
        handle = (ROOT / (".extension-agent-loop.lock" if self.applications.owned else ".extension-sdk.lock")).open("a")
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            handle.close()
            raise RuntimeError("Another SDK extension owns this QEMU environment.")
        self.lock_file = handle

    def release(self):
        if self.lock_file:
            fcntl.flock(self.lock_file, fcntl.LOCK_UN)
            self.lock_file.close()
            self.lock_file = None

    def run_capture(self, command, source, timeout=120, env=None):
        with self.capture_lock:
            if closing.is_set():
                raise RuntimeError("SDK bridge is shutting down")
            proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    stdin=subprocess.DEVNULL, start_new_session=True, env=env)
            self.capture = proc
            if source == "agent-build":
                self.update(buildPid=proc.pid)
        outputs = {"stdout": [], "stderr": []}

        def read(stream, name):
            decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
            while True:
                data = os.read(stream.fileno(), 65536)
                if not data:
                    break
                text = decoder.decode(data)
                outputs[name].append(text)
                self.console(source, name, text)

        threads = [threading.Thread(target=read, args=(proc.stdout, "stdout"), daemon=True),
                   threading.Thread(target=read, args=(proc.stderr, "stderr"), daemon=True)]
        for thread in threads:
            thread.start()
        try:
            code = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            terminate_owned(proc)
            raise TimeoutError(source + " timed out after " + str(timeout) + " seconds")
        finally:
            for thread in threads:
                thread.join(timeout=3)
            proc.stdout.close()
            proc.stderr.close()
            self.capture = None
            if source == "agent-build":
                self.update(buildPid=None)
        return dict(stdout="".join(outputs["stdout"]), stderr="".join(outputs["stderr"]), exitCode=code)

    def validate(self):
        checks = []

        def check(name, ok, detail):
            checks.append(dict(name=name, ok=bool(ok), detail=detail))

        check("SDK directory", SDK.is_dir() and SDK.resolve() == SDK, str(SDK))
        check("Linux test directory", ROOT.is_dir() and ROOT.resolve() == ROOT, str(ROOT))
        check("kernel", KERNEL.is_file() and KERNEL.resolve().is_relative_to(SDK), str(KERNEL))
        for name in ("env.sh", "build-example.sh", "build-cmake-example.sh", "start-qemu.sh", "connect-wrdbg.sh", "validate.py"):
            path = SCRIPTS / name
            check(name, path.is_file() and path.resolve().is_relative_to(ROOT), str(path))
        check("sdkenv.sh", (SDK / "sdkenv.sh").is_file(), str(SDK / "sdkenv.sh"))
        if all(c["ok"] for c in checks):
            # A constant shell program; the script path is a positional argument, never interpolation.
            sourced = subprocess.run(["/bin/bash", "--noprofile", "--norc", "-c",
                                      'source "$1" >/dev/null && env -0', "sdk-env", str(SCRIPTS / "env.sh")],
                                     capture_output=True, timeout=20)
            check("source SDK", sourced.returncode == 0, sourced.stderr.decode(errors="replace"))
            env = {}
            for item in sourced.stdout.split(b"\0"):
                if b"=" in item:
                    key, value = item.split(b"=", 1)
                    env[key.decode()] = value.decode()
            check("WIND_SDK_HOME", env.get("WIND_SDK_HOME") == str(SDK), env.get("WIND_SDK_HOME", "(missing)"))
            check("Linux PATH", not any(p.startswith("/mnt/") for p in env.get("PATH", "").split(":")), env.get("PATH", ""))
            import shutil
            for tool, args in (("wr-cc", ["--version"]), ("wrdbg", ["--help"]), ("qemu-system-x86_64", ["--version"])):
                found = shutil.which(tool, path=env.get("PATH", ""))
                path_ok = found is not None and (tool.startswith("qemu") or pathlib.Path(found).resolve().is_relative_to(SDK))
                check(tool + " path", path_ok, found or "(missing)")
                if path_ok:
                    result = self.run_capture([found] + args, "environment", timeout=20, env=env)
                    check(tool + " execution", result["exitCode"] == 0, (result["stdout"] + result["stderr"]).strip())
        ready = all(c["ok"] for c in checks)
        if ready:
            self.sdk_env = env
        self.update(sdk="Ready" if ready else "Error",
                    error=None if ready else "; ".join(c["name"] + ": " + c["detail"] for c in checks if not c["ok"]))
        return dict(ready=ready, checks=checks)

    def ready(self):
        if self.state["sdk"] != "Ready":
            result = self.validate()
            if not result["ready"]:
                raise RuntimeError("Environment validation failed: " + self.state["error"])

    def build(self):
        self.ready()
        result = self.run_capture(["/bin/bash", str(SCRIPTS / "build-example.sh")], "build")
        if result["exitCode"] == 0:
            if not BINARY.is_file() or not BINARY.resolve().is_relative_to(ROOT):
                raise RuntimeError("Build exited successfully but output is missing: " + str(BINARY))
            result["outputFile"] = str(BINARY)
        return result

    def clean(self):
        self.ready()
        if self.qemu is not None or self.debugger is not None:
            raise RuntimeError("Stop this backend's QEMU/debugger before cleaning.")
        # No recursive deletion, SDK edits, or CMake build-tree removal.
        if BINARY.is_symlink() or not BINARY.parent.resolve().is_relative_to(ROOT):
            raise RuntimeError("Refusing to clean a path outside the verified test directory.")
        BINARY.unlink(missing_ok=True)
        return dict(stdout="Removed only " + str(BINARY) + "\n", stderr="", exitCode=0)

    def ports_available(self):
        for port in ((11534, 12345) if self.applications.owned else (1534, 2345)):
            with socket.socket() as probe:
                try:
                    probe.bind(("127.0.0.1", port))
                except OSError:
                    raise RuntimeError("Local port %s is occupied. Stop its owner manually; no external process was killed." % port)

    def startQemu(self):
        self.ready()
        if self.qemu and not self.qemu.closed:
            return self.waitForBoot()
        if self.qemu:
            self.stop()
        self.acquire()
        try:
            self.ports_available()
            self.update(qemu="Running", vxworks="Booting", error=None)
            command = ["/bin/bash", str(SCRIPTS / "start-qemu.sh")]
            if self.applications.owned:
                command = self.loop_command("start-qemu.sh", "qemu-system-x86_64")
            self.console("lifecycle", "command", json.dumps(command) + "\n")
            self.qemu = Terminal(self, "qemu", command, env=self.sdk_env, cwd=SDK)
            self.update(qemuPid=self.qemu.proc.pid)
            return self.waitForBoot()
        except Exception:
            self.stop()
            raise

    def waitForBoot(self):
        if not self.qemu:
            raise RuntimeError("QEMU is not running")
        if self.state["vxworks"] != "Ready":
            self.qemu.expect(BOOT_PATTERN, timeout=60)
            self.update(vxworks="Ready")
        return self.state.copy()

    def debugStart(self):
        self.ready()
        # AUTO debug_start must never implicitly launch a target.
        if not self.qemu or self.qemu.closed or self.state["vxworks"] != "Ready":
            raise RuntimeError("Start QEMU first; starting a target requires target_run permission.")
        if self.debugger and not self.debugger.closed:
            return self.state.copy()
        if self.debugger:
            self.debugStop()
        self.update(debugger="Connecting")
        try:
            command = ["/bin/bash", str(SCRIPTS / "connect-wrdbg.sh")]
            if self.applications.owned:
                command = self.loop_command("connect-wrdbg.sh", "wrdbg")
            self.console("lifecycle", "command", json.dumps(command) + "\n")
            self.debugger = Terminal(self, "wrdbg", command, env=self.sdk_env, cwd=SDK)
            self.update(debuggerPid=self.debugger.proc.pid)
            output = self.debugger.expect(PROMPT)
            if ("Connected to TCP:127.0.0.1:" + ("11534" if self.applications.owned else "1534")) not in output:
                raise RuntimeError("wrdbg connection failed:\n" + output)
            return self.update(debugger="Connected")
        except Exception:
            self.debugStop()
            raise

    def debugStop(self):
        terminal = self.debugger
        if terminal:
            try:
                if not terminal.closed:
                    terminal.send("quit")
                    terminal.proc.wait(timeout=8)
            except (OSError, subprocess.TimeoutExpired):
                pass
            finally:
                terminal.stop()
                self.debugger = None
        return self.update(debugger="Disconnected", debuggerPid=None)

    def stop(self):
        self.debugStop()
        if self.qemu:
            self.qemu.stop()
            self.qemu = None
        self.release()
        return self.update(qemu="Stopped", vxworks="Stopped", qemuPid=None)

    def run(self):
        self.ready()
        if not BINARY.is_file() or not BINARY.resolve().is_relative_to(ROOT):
            raise RuntimeError("Build the RTP first: " + str(BINARY))
        self.startQemu()
        self.debugStart()
        try:
            cursor = self.debugger.mark()
            self.debugger.send("file " + str(BINARY))
            loaded = self.debugger.expect(PROMPT, cursor)
            if "Reading symbols" not in loaded or "New inferior" not in loaded:
                raise RuntimeError("RTP load failed:\n" + loaded)
            cursor = self.debugger.mark()
            self.debugger.send("run")
            output = self.debugger.expect(PROMPT, cursor)
            if "Hello World" not in output or not re.search(r"\[Inferior .* exited\]", output):
                raise RuntimeError("RTP did not print Hello World and exit:\n" + output)
            # VxWorks exit status is not numeric in this debugger's transcript.
            return dict(stdout=loaded + output, stderr="", exitCode=None, outputFile=str(BINARY),
                        completed=True, logDirectory=str(self.log_dir))
        except Exception:
            self.debugStop()  # Reconnect rather than reuse a potentially desynchronized debugger.
            raise

    def loop_command(self, script, tool):
        # Read the verified command, never rewrite the existing Linux script.
        text = (SCRIPTS / script).read_text().replace("\\\n", " ")
        commands = [line for line in text.splitlines() if line.startswith("exec ")]
        if len(commands) != 1:
            raise ValueError("Expected one explicit exec command in " + script)
        command = shlex.split(commands[0])[1:]
        if not command or command[0] != tool or any(token in command for token in [";", "&&", "|", ">"]):
            raise ValueError("Unsupported script command; refusing to guess")
        command[0] = shutil.which(tool, path=self.sdk_env["PATH"])
        replacements = ({"hostfwd=tcp:127.0.0.1:1534-:1534": "hostfwd=tcp:127.0.0.1:11534-:1534",
                         "hostfwd=tcp:127.0.0.1:2345-:2345": "hostfwd=tcp:127.0.0.1:12345-:2345"}
                        if tool.startswith("qemu") else {"vxworks7:127.0.0.1:1534": "vxworks7:127.0.0.1:11534"})
        for old, new in replacements.items():
            if sum(token.count(old) for token in command) != 1:
                raise ValueError("Expected original forwarding/connection argument missing")
            command = [token.replace(old, new) for token in command]
        return command

    def application_command(self, runId):
        source, binary = self.applications.check(runId)
        compiler = shutil.which("wr-cc", path=self.sdk_env["PATH"])
        return [compiler, "-rtp", str(source), "-static", "-g", "-o", str(binary)]

    def writeApplication(self, runId, source, previousHash):
        self.ready()
        result = self.applications.write(runId, source, previousHash)
        result["buildCommand"] = self.application_command(runId)
        return result

    def buildApplication(self, runId):
        self.ready()
        command = self.application_command(runId)
        self.applications.owned[runId]["built"] = None
        result = self.run_capture(command, "agent-build", env=self.sdk_env)
        result["command"] = command
        if result["exitCode"] == 0:
            self.applications.built(runId)
            result["outputFile"] = command[-1]
        return result

    def runApplication(self, runId):
        binary = self.applications.runnable(runId)
        self.startQemu()
        self.debugStart()
        cursor = self.debugger.mark()
        self.debugger.send("file " + str(binary))
        loaded = self.debugger.expect(PROMPT, cursor)
        if "Reading symbols" not in loaded or "New inferior" not in loaded:
            raise RuntimeError("RTP load failed:\n" + loaded)
        cursor = self.debugger.mark()
        self.debugger.send("run")
        output = self.debugger.expect(PROMPT, cursor)
        completed = bool(re.search(r"\[Inferior .* exited\]", output))
        # This transcript has no numeric target exit code. Preserve it separately.
        lines = output.replace("\r", "").splitlines()
        actual = "\n".join(line for line in lines if line.strip() and
                           not line.startswith("Starting program:") and
                           not line.startswith("[Inferior ") and
                           not line.startswith("(wrdbg)"))
        return dict(stdout=loaded + output, stderr="", exitCode=None,
                    outputFile=str(binary), completed=completed, actualOutput=actual)

    def fullValidation(self):
        self.ready()
        if self.qemu is not None or self.debugger is not None:
            raise RuntimeError("Stop this backend's QEMU/debugger before Full Validation (ports 1534/2345 must be free).")
        self.acquire()
        try:
            self.ports_available()
            result = self.run_capture(["/usr/bin/python3", str(SCRIPTS / "validate.py")], "validation", timeout=240)
            paths = re.findall(r"^Logs: (.+)$", result["stdout"], re.MULTILINE)
            if paths:
                path = pathlib.Path(paths[-1].strip()) / "result.json"
                if not path.resolve().is_relative_to((ROOT / "logs").resolve()):
                    raise RuntimeError("Validation returned an unexpected result path")
                data = json.loads(path.read_text())
                result.update(resultPath=str(path), result=data)
                passed = data.get("status") == "PASS" and bool(data.get("checks")) and all(c.get("passed") is True for c in data["checks"])
                if not passed and result["exitCode"] == 0:
                    result["exitCode"] = 1
            else:
                result["exitCode"] = result["exitCode"] or 1
                result["stderr"] += "\nNo fresh result.json was reported; older validation results were not reused."
            return result
        finally:
            self.release()

    def shutdown(self):
        closing.set()
        with self.capture_lock:
            if self.capture:
                terminate_owned(self.capture)
        with self.operation_lock:
            return self.stop()


backend = Backend()
requests = queue.Queue()
OPERATIONS = {"validate", "build", "clean", "startQemu", "waitForBoot", "run",
              "stop", "debugStart", "debugStop", "fullValidation", "shutdown",
              "writeApplication", "buildApplication", "runApplication"}


def worker():
    while not closing.is_set():
        request = requests.get()
        if request is None:
            break
        request_id = request.get("id")
        try:
            operation = request.get("operation")
            if operation not in OPERATIONS:
                raise ValueError("Unsupported SDK operation: " + str(operation))
            with backend.operation_lock:
                args = request.get("args", {})
                if not isinstance(args, dict) or (args and operation not in {"writeApplication", "buildApplication", "runApplication"}):
                    raise ValueError("Unexpected operation arguments")
                result = getattr(backend, operation)(**args)
                if operation != "validate" and backend.state.get("error") is not None:
                    backend.update(error=None)
            emit(dict(id=request_id, ok=True, result=result))
        except Exception as exc:
            backend.update(error=str(exc))
            emit(dict(id=request_id, ok=False, error=str(exc)))


def interrupted(signum, frame):
    raise KeyboardInterrupt()


signal.signal(signal.SIGTERM, interrupted)
thread = threading.Thread(target=worker, daemon=True)
thread.start()
try:
    for line in sys.stdin:
        try:
            message = json.loads(line)
            if not isinstance(message, dict) or not isinstance(message.get("id"), int):
                raise ValueError("Request must contain numeric id")
            requests.put(message)
        except (ValueError, TypeError) as exc:
            emit(dict(id=None, ok=False, error=str(exc)))
except KeyboardInterrupt:
    pass
finally:
    closing.set()
    backend.shutdown()
    requests.put(None)
    thread.join(timeout=10)
