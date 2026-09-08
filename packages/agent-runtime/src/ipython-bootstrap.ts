/**
 * Constrained Python session bootstrap used by an injected child-process adapter.
 * The child has no Maestro credentials and receives no raw host I/O capability.
 * All useful project access goes through the versioned host-request bridge.
 */
export const IPYTHON_PYTHON_BOOTSTRAP = String.raw`import ast
import contextlib
import io
import json
import sys
import threading

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
    if not isinstance(result, dict) or not isinstance(result.get("content"), str):
        raise RuntimeError("IPython host response is invalid")
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
