import type { IpPythonExecutionResult } from "../ipython-tool.js";
import { IPYTHON_PROTOCOL_VERSION, IpPythonProtocolError, MAX_FRAME_BYTES, type DataClass, type IpPythonFrame } from "./frames.js";
import type { IpPythonHostBinding, IpPythonReadOnlyGateway } from "./gateway.js";
import type { IpPythonHostRequest } from "./two-stage.js";

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload))
    throw new IpPythonProtocolError("IPython host payload must be an object");
  return payload as Record<string, unknown>;
}

function relativeReadPath(value: unknown): string {
  const path = requiredString(value, "path");
  if (path.includes("\\") || path.startsWith("/") || path.split("/").some((part) => part === ".."))
    throw new IpPythonProtocolError("IPython read path is outside the Goal scope");
  return path;
}

function gitRef(value: unknown): string {
  const ref = requiredString(value, "ref");
  if (ref.includes("\0") || /\s/.test(ref)) throw new IpPythonProtocolError("IPython Git ref is invalid");
  return ref;
}

function validateHostResult(value: IpPythonExecutionResult, binding: IpPythonHostBinding): IpPythonExecutionResult {
  if (
    value === null ||
    typeof value !== "object" ||
    !["ok", "error", "cancelled", "unknown"].includes(value.state) ||
    typeof value.content !== "string" ||
    !["public", "workspace", "private", "pii", "phi", "secret"].includes(value.dataClass)
  )
    throw new IpPythonProtocolError("IPython host result is invalid");
  if (!binding.outboundDataClasses.includes(value.dataClass))
    throw new IpPythonProtocolError("IPython host result data class is outside the Goal scope");
  if (Buffer.byteLength(value.content, "utf8") > MAX_FRAME_BYTES)
    throw new IpPythonProtocolError("IPython host result exceeds the output limit");
  return value;
}

function stableBindingKey(binding: IpPythonHostBinding): string {
  const { admissionCommandId: _admissionCommandId, commandId: _commandId, toolCallId: _toolCallId, ...stableBinding } = binding;
  return JSON.stringify(stableBinding);
}

export function createReadOnlyHostRequestHandler(options: {
  readonly binding: IpPythonHostBinding;
  readonly gateway: IpPythonReadOnlyGateway;
}): (request: IpPythonHostRequest, binding?: IpPythonHostBinding) => Promise<IpPythonExecutionResult> {
  return async (request, requestBinding) => {
    const binding = requestBinding ?? options.binding;
    if (stableBindingKey(binding) !== stableBindingKey(options.binding))
      throw new IpPythonProtocolError("IPython host binding identity changed");
    const payload = payloadRecord(request.payload);
    if (request.method === "read_file")
      return validateHostResult(await options.gateway.readFile(binding, relativeReadPath(payload.path)), binding);
    if (request.method === "git_revision")
      return validateHostResult(await options.gateway.gitRevision(binding, gitRef(payload.ref)), binding);
    throw new IpPythonProtocolError(`IPython host method is not allowed: ${request.method}`);
  };
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new IpPythonProtocolError("IPython frame must be an object");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new IpPythonProtocolError(`IPython frame ${name} is required`);
  return value;
}

function dataClass(value: unknown): DataClass {
  if (!["public", "workspace", "private", "pii", "phi", "secret"].includes(value as string))
    throw new IpPythonProtocolError("IPython frame data class is invalid");
  return value as DataClass;
}

function executionState(value: unknown): IpPythonExecutionResult["state"] {
  if (!["ok", "error", "cancelled", "unknown"].includes(value as string))
    throw new IpPythonProtocolError("IPython frame execution state is invalid");
  return value as IpPythonExecutionResult["state"];
}

export function parseIpPythonFrame(value: unknown): IpPythonFrame {
  const input = record(value);
  if (input.version !== IPYTHON_PROTOCOL_VERSION) throw new IpPythonProtocolError("IPython protocol version is unsupported");
  const type = input.type;
  if (type === "ready") {
    if (input.runtime !== "python") throw new IpPythonProtocolError("IPython runtime is unsupported");
    return { version: IPYTHON_PROTOCOL_VERSION, type, runtime: "python" };
  }
  if (type === "execute") {
    return {
      version: IPYTHON_PROTOCOL_VERSION,
      type,
      requestId: requiredString(input.requestId, "requestId"),
      sessionId: requiredString(input.sessionId, "sessionId"),
      code: requiredString(input.code, "code"),
    };
  }
  if (type === "host_request") {
    return {
      version: IPYTHON_PROTOCOL_VERSION,
      type,
      requestId: requiredString(input.requestId, "requestId"),
      hostRequestId: requiredString(input.hostRequestId, "hostRequestId"),
      method: requiredString(input.method, "method"),
      payload: input.payload,
    };
  }
  if (type === "done") {
    const content =
      typeof input.content === "string"
        ? input.content
        : (() => {
            throw new IpPythonProtocolError("IPython frame content is required");
          })();
    if (input.truncated !== undefined && typeof input.truncated !== "boolean")
      throw new IpPythonProtocolError("IPython frame truncation flag is invalid");
    return {
      version: IPYTHON_PROTOCOL_VERSION,
      type,
      requestId: requiredString(input.requestId, "requestId"),
      state: executionState(input.state),
      dataClass: dataClass(input.dataClass),
      content,
      ...(input.reason === undefined ? {} : { reason: requiredString(input.reason, "reason") }),
      ...(input.truncated === undefined ? {} : { truncated: input.truncated }),
    };
  }
  if (type === "interrupt") return { version: IPYTHON_PROTOCOL_VERSION, type, requestId: requiredString(input.requestId, "requestId") };
  if (type === "shutdown") return { version: IPYTHON_PROTOCOL_VERSION, type };
  if (type === "event") {
    const stream = input.stream;
    if (stream !== "stdout" && stream !== "stderr") throw new IpPythonProtocolError("IPython event stream is invalid");
    return {
      version: IPYTHON_PROTOCOL_VERSION,
      type,
      requestId: requiredString(input.requestId, "requestId"),
      stream,
      text:
        typeof input.text === "string"
          ? input.text
          : (() => {
              throw new IpPythonProtocolError("IPython event text is required");
            })(),
    };
  }
  if (type === "error")
    return {
      version: IPYTHON_PROTOCOL_VERSION,
      type,
      requestId: requiredString(input.requestId, "requestId"),
      reason: requiredString(input.reason, "reason"),
    };
  if (type === "host_response") {
    if (typeof input.ok !== "boolean") throw new IpPythonProtocolError("IPython host response status is invalid");
    return {
      version: IPYTHON_PROTOCOL_VERSION,
      type,
      requestId: requiredString(input.requestId, "requestId"),
      hostRequestId: requiredString(input.hostRequestId, "hostRequestId"),
      ok: input.ok,
      ...(input.result === undefined ? {} : { result: input.result as IpPythonExecutionResult }),
      ...(input.error === undefined ? {} : { error: requiredString(input.error, "error") }),
    };
  }
  throw new IpPythonProtocolError("IPython frame type is unsupported");
}
