/**
 * Constrained Python session bootstrap used by an injected child-process adapter.
 * The child has no Maestro credentials and receives no raw host I/O capability.
 * All useful project access goes through the versioned host-request bridge.
 */
export const IPYTHON_PYTHON_BOOTSTRAP = String.raw`import ast
import contextlib
import io
import json
import os
import signal
import sys
import threading
import time

VERSION = 1
MAX_FRAME_BYTES = 1_048_576
MAX_OUTPUT_BYTES = 64_000

_write_lock = threading.Lock()
_host_lock = threading.Condition()
_host_responses = {}
_host_counter = 0
_active_request = None
_interrupt = threading.Event()
_shutdown = threading.Event()
_namespace = {}
_session_id = None
_parent_pid_text = os.environ.get("MAESTRO_PARENT_PID")
_parent_identity = os.environ.get("MAESTRO_PARENT_IDENTITY")
_owned_process_group = os.environ.get("MAESTRO_OWNED_PROCESS_GROUP") == "1"


def parent_identity(pid):
    with open("/proc/" + str(pid) + "/stat", "r", encoding="utf-8") as stat_file:
        stat = stat_file.read()
    command_end = stat.rfind(")")
    fields = stat[command_end + 2:].strip().split()
    if len(fields) <= 19:
        raise RuntimeError("parent process identity is unavailable")
    return fields[19]


def terminate_owned_group_or_exit():
    # The production adapter starts this child as a detached process-group
    # leader. Kill the complete group before exiting so same-group descendants
    # cannot survive a Control Plane crash. Test/non-detached launches retain
    # the safe exit-only behavior and must never signal the caller's group.
    try:
        group_id = os.getpgrp()
        if _owned_process_group and group_id > 1:
            os.killpg(group_id, signal.SIGKILL)
            return
    except Exception:
        pass
    os._exit(70)


def parent_watchdog():
    if not _parent_pid_text or not _parent_identity:
        terminate_owned_group_or_exit()
    try:
        expected_pid = int(_parent_pid_text)
        if expected_pid <= 0:
            raise ValueError("parent PID is invalid")
    except Exception:
        terminate_owned_group_or_exit()
    while True:
        try:
            if os.getppid() != expected_pid or parent_identity(expected_pid) != _parent_identity:
                terminate_owned_group_or_exit()
        except Exception:
            terminate_owned_group_or_exit()
        time.sleep(0.05)


if _parent_pid_text is not None or _parent_identity is not None:
    threading.Thread(target=parent_watchdog, daemon=True).start()


def send(frame):
    frame["version"] = VERSION
    encoded = json.dumps(frame, ensure_ascii=False, separators=(",", ":"))
    with _write_lock:
        sys.__stdout__.write(encoded + "\n")
        sys.__stdout__.flush()


def required_string(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(name + " is required")
    return value


def host_call(request_id, method, payload):
    global _host_counter
    if request_id != _active_request:
        raise RuntimeError("IPython host helper expired")
    with _host_lock:
        _host_counter += 1
        host_request_id = "host-" + str(_host_counter)
    send({"type": "host_request", "requestId": request_id, "hostRequestId": host_request_id, "method": method, "payload": payload})
    with _host_lock:
        while host_request_id not in _host_responses:
            if _interrupt.is_set() or _shutdown.is_set():
                raise InterruptedError("IPython host request interrupted")
            _host_lock.wait(0.05)
        response = _host_responses.pop(host_request_id)
    if not response.get("ok"):
        raise RuntimeError(response.get("error", "IPython host request failed"))
    result = response.get("result")
    if not isinstance(result, dict) or result.get("state") != "ok" or not isinstance(result.get("content"), str):
        raise RuntimeError("IPython host response is invalid or not successful")
    return result.get("content")


def validate_code(code):
    tree = ast.parse(code, filename="<ipython>", mode="exec")
    forbidden_names = {"__builtins__", "__import__", "open", "exec", "eval", "compile", "breakpoint", "help", "input"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id in forbidden_names:
            raise ValueError("direct I/O or dynamic execution is not allowed")
        if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            raise ValueError("dunder escape paths are not allowed")
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise ValueError("direct imports are not allowed")
    return tree


class Host:
    def __init__(self, request_id):
        self._request_id = request_id

    def read_file(self, path):
        return host_call(self._request_id, "read_file", {"path": path})

    def git_revision(self, ref="HEAD"):
        return host_call(self._request_id, "git_revision", {"ref": ref})

    def write_file(self, path, content):
        return host_call(self._request_id, "write_file", {"path": path, "content": content})

    def run_command(self, action, target, argv, cwd, environment=None, timeoutMs=None, outputCapBytes=None):
        payload = {"action": action, "target": target, "argv": argv, "cwd": cwd}
        if environment is not None:
            payload["environment"] = environment
        if timeoutMs is not None:
            payload["timeoutMs"] = timeoutMs
        if outputCapBytes is not None:
            payload["outputCapBytes"] = outputCapBytes
        return host_call(self._request_id, "run_command", payload)

    def git_create_branch(self, branchName, baseRevision):
        return host_call(self._request_id, "git_create_branch", {"branchName": branchName, "baseRevision": baseRevision})

    def git_create_worktree(self, worktreePath, branchName):
        return host_call(self._request_id, "git_create_worktree", {"worktreePath": worktreePath, "branchName": branchName})

    def git_commit(self, worktreePath, message, authorName, authorEmail):
        return host_call(self._request_id, "git_commit", {"worktreePath": worktreePath, "message": message, "authorName": authorName, "authorEmail": authorEmail})

    def git_advance_branch(self, branchName, expectedRevision, targetRevision):
        return host_call(self._request_id, "git_advance_branch", {"branchName": branchName, "expectedRevision": expectedRevision, "targetRevision": targetRevision})

    def git_remove_worktree(self, worktreePath):
        return host_call(self._request_id, "git_remove_worktree", {"worktreePath": worktreePath})


class BoundedWriter(io.TextIOBase):
    def __init__(self, request_id, stream):
        self.request_id = request_id
        self.stream = stream
        self.parts = []
        self.size = 0
        self.truncated = False

    def writable(self):
        return True

    def write(self, text):
        if not isinstance(text, str) or not text:
            return 0
        remaining = MAX_OUTPUT_BYTES - self.size
        if remaining <= 0:
            self.truncated = True
            return len(text)
        encoded = text.encode("utf-8")
        if len(encoded) > remaining:
            encoded = encoded[:remaining]
            while encoded and (encoded[-1] & 0xC0) == 0x80:
                encoded = encoded[:-1]
            text = encoded.decode("utf-8", errors="ignore")
            self.truncated = True
        self.parts.append(text)
        self.size += len(text.encode("utf-8"))
        send({"type": "event", "requestId": self.request_id, "stream": self.stream, "text": text})
        return len(text)

    def flush(self):
        return None

    def content(self):
        return "".join(self.parts)


_safe_builtins = {
    "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict,
    "enumerate": enumerate, "filter": filter, "float": float, "int": int,
    "len": len, "list": list, "map": map, "max": max, "min": min,
    "print": print, "range": range, "repr": repr, "reversed": reversed,
    "round": round, "set": set, "sorted": sorted, "str": str, "sum": sum,
    "tuple": tuple, "zip": zip,
}


def execute(frame):
    global _active_request
    request_id = frame["requestId"]
    _interrupt.clear()
    stdout = BoundedWriter(request_id, "stdout")
    stderr = BoundedWriter(request_id, "stderr")
    local_namespace = _namespace
    local_namespace["host"] = Host(request_id)
    local_namespace["read_file"] = local_namespace["host"].read_file
    local_namespace["git_revision"] = local_namespace["host"].git_revision
    local_namespace["write_file"] = local_namespace["host"].write_file
    local_namespace["run_command"] = local_namespace["host"].run_command
    local_namespace["git_create_branch"] = local_namespace["host"].git_create_branch
    local_namespace["git_create_worktree"] = local_namespace["host"].git_create_worktree
    local_namespace["git_commit"] = local_namespace["host"].git_commit
    local_namespace["git_advance_branch"] = local_namespace["host"].git_advance_branch
    local_namespace["git_remove_worktree"] = local_namespace["host"].git_remove_worktree
    local_namespace["__builtins__"] = _safe_builtins
    try:
        code = required_string(frame.get("code"), "code")
        if len(code.encode("utf-8")) > MAX_OUTPUT_BYTES:
            raise ValueError("code exceeds the input limit")
        tree = validate_code(code)
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            exec(compile(tree, "<ipython>", "exec"), local_namespace, local_namespace)
        state = "cancelled" if _interrupt.is_set() else "ok"
        content = stdout.content()
        if stderr.content():
            content += ("\n" if content else "") + stderr.content()
        send({"type": "done", "requestId": request_id, "state": state, "dataClass": "workspace", "content": content, "truncated": stdout.truncated or stderr.truncated})
    except InterruptedError as error:
        send({"type": "done", "requestId": request_id, "state": "cancelled", "dataClass": "workspace", "content": str(error), "reason": "interrupted"})
    except Exception as error:
        reason = type(error).__name__ + ": " + str(error)
        send({"type": "done", "requestId": request_id, "state": "error", "dataClass": "workspace", "content": reason, "reason": reason})
    finally:
        with _host_lock:
            _active_request = None
            _host_lock.notify_all()


def handle(frame):
    global _active_request, _session_id
    if not isinstance(frame, dict) or frame.get("version") != VERSION:
        raise ValueError("unsupported IPython protocol frame")
    frame_type = frame.get("type")
    if frame_type == "execute":
        request_id = required_string(frame.get("requestId"), "requestId")
        session_id = required_string(frame.get("sessionId"), "sessionId")
        if _session_id is None:
            _session_id = session_id
        elif _session_id != session_id:
            send({"type": "done", "requestId": request_id, "state": "error", "dataClass": "workspace", "content": "IPython session identity changed", "reason": "session_identity_changed"})
            return
        with _host_lock:
            if _active_request is not None:
                send({"type": "done", "requestId": request_id, "state": "error", "dataClass": "workspace", "content": "IPython kernel is busy", "reason": "busy"})
                return
            _active_request = request_id
        threading.Thread(target=execute, args=(frame,), daemon=True).start()
        return
    if frame_type == "host_response":
        host_request_id = required_string(frame.get("hostRequestId"), "hostRequestId")
        with _host_lock:
            _host_responses[host_request_id] = frame
            _host_lock.notify_all()
        return
    if frame_type == "interrupt":
        _interrupt.set()
        with _host_lock:
            _host_lock.notify_all()
        return
    if frame_type == "shutdown":
        _shutdown.set()
        _interrupt.set()
        with _host_lock:
            _host_lock.notify_all()
        return
    raise ValueError("unsupported IPython frame type")


send({"type": "ready", "runtime": "python"})
for raw_line in sys.stdin:
    if len(raw_line.encode("utf-8")) > MAX_FRAME_BYTES:
        send({"type": "error", "requestId": "protocol", "reason": "IPython protocol frame exceeds the input limit"})
        continue
    if not raw_line.strip():
        continue
    try:
        handle(json.loads(raw_line))
    except Exception as error:
        with _host_lock:
            request_id = _active_request or "protocol"
        send({"type": "error", "requestId": request_id, "reason": str(error)})
    if _shutdown.is_set():
        break
`;
