import {
  ExecutionKernelUnavailableError,
  type ExecutionKernelPort,
  type ExecutionRef,
  type InvocationRef,
  type ModelIdentity,
  type SpawnRequest,
  type SpawnedInvocation,
  type InvocationStatus,
  type InvocationUsage,
  type ToolEvents,
} from "@maestro/domain";
import {
  createMaestroAgentRuntime,
  parseModelRef,
  type GatewayBinding,
  type MaestroAgentRuntime,
  type ModelGatewayPort,
  ToolRegistry,
} from "@maestro/agent-runtime";

type RuntimeRecord = {
  readonly runtime: MaestroAgentRuntime;
  readonly binding: GatewayBinding;
};

export interface NativeExecutionKernelOptions {
  readonly gateway: ModelGatewayPort;
  readonly gatewayOperatorId: string;
  readonly accountRefs: Readonly<Record<string, string>>;
  readonly dataPolicyHash: string;
  readonly tools: ToolRegistry;
}

function requireAdmission(request: SpawnRequest): {
  modelRef: string;
  model: ModelIdentity;
  accountRef?: string;
} {
  if (request.context === undefined || request.grant === undefined || request.modelPolicy === undefined || request.idempotencyKey === undefined) {
    throw new Error("native invocation requires host-owned context, grant, model policy, and idempotency key");
  }
  if (request.modelPolicy.length !== 1) throw new Error("native invocation requires exactly one model policy");
  const modelRef = request.modelPolicy[0];
  if (modelRef === undefined) throw new Error("native invocation requires exactly one model policy");
  const model = parseModelRef(modelRef);
  if (request.grant.modelPolicy.length !== 1 || request.grant.modelPolicy[0] !== modelRef) {
    throw new Error("native invocation grant model policy mismatch");
  }
  const accountRef = request.context.accountRef;
  if (accountRef !== undefined && accountRef.trim() === "") throw new Error("native invocation account binding is empty");
  return { modelRef, model, ...(accountRef === undefined ? {} : { accountRef }) };
}

function assertBindingMatches(binding: GatewayBinding, model: ModelIdentity, accountRef: string): void {
  if (binding.provider.provider !== model.provider || binding.provider.id !== model.id) {
    throw new Error("model gateway returned an unexpected model identity");
  }
  if (binding.account.providerId !== model.provider || binding.account.accountRef !== accountRef) {
    throw new Error("model gateway returned an unexpected account binding");
  }
}

/**
 * Control Plane adapter for the native runtime. A gateway binding is immutable
 * for one root execution; opaque execution/invocation refs are routed back to
 * that bound runtime without exposing the runtime registry to callers.
 */
export function createNativeExecutionKernel(options: NativeExecutionKernelOptions): ExecutionKernelPort & { close(): Promise<void> } {
  const executions = new Map<ExecutionRef, RuntimeRecord>();
  const invocations = new Map<InvocationRef, RuntimeRecord>();
  let closed = false;

  async function admitRoot(request: SpawnRequest): Promise<RuntimeRecord> {
    const admission = requireAdmission(request);
    const configuredAccountRef = options.accountRefs[admission.model.provider];
    if (configuredAccountRef === undefined || (admission.accountRef !== undefined && configuredAccountRef !== admission.accountRef)) {
      throw new Error("native invocation account binding mismatch");
    }
    const accountRef = admission.accountRef ?? configuredAccountRef;
    const binding = await options.gateway.admit({
      requestId: request.idempotencyKey!,
      operatorId: options.gatewayOperatorId,
      providerId: admission.model.provider,
      model: admission.model,
      accountRef,
      dataPolicyHash: options.dataPolicyHash,
    });
    assertBindingMatches(binding, admission.model, accountRef);
    return {
      binding,
      runtime: createMaestroAgentRuntime({ gateway: options.gateway, binding, tools: options.tools, closeGateway: false }),
    };
  }

  function runtimeForExecution(execution: ExecutionRef): RuntimeRecord {
    const record = executions.get(execution);
    if (record === undefined) throw new ExecutionKernelUnavailableError("prompt");
    return record;
  }

  function runtimeForInvocation(invocation: InvocationRef): RuntimeRecord | undefined {
    return invocations.get(invocation);
  }

  const kernel: ExecutionKernelPort & { close(): Promise<void> } = {
    async spawn(request): Promise<SpawnedInvocation> {
      if (closed) throw new Error("native execution kernel is closed");
      if (request.parent !== undefined) {
        const parent = runtimeForExecution(request.parent);
        const spawned = await parent.runtime.spawn(request);
        invocations.set(spawned.invocation, parent);
        return spawned;
      }
      const record = await admitRoot(request);
      try {
        const spawned = await record.runtime.spawn(request);
        executions.set(spawned.execution, record);
        invocations.set(spawned.invocation, record);
        return spawned;
      } catch (error) {
        await record.runtime.close?.().catch(() => undefined);
        throw error;
      }
    },

    async prompt(execution, text) {
      const record = executions.get(execution);
      if (record === undefined) throw new ExecutionKernelUnavailableError("prompt");
      await record.runtime.prompt(execution, text);
    },

    async observe(execution) {
      const record = executions.get(execution);
      return record === undefined ? [] : record.runtime.observe(execution);
    },

    async sendMessage(execution, invocation, message) {
      const record = executions.get(execution);
      if (record === undefined) throw new ExecutionKernelUnavailableError("sendMessage");
      await record.runtime.sendMessage(execution, invocation, message);
    },

    async cancel(invocation) {
      const record = runtimeForInvocation(invocation);
      return record === undefined ? { cancelled: false } : record.runtime.cancel(invocation);
    },

    async getModelIdentity(execution) {
      const record = executions.get(execution);
      if (record === undefined) throw new ExecutionKernelUnavailableError("getModelIdentity");
      return record.binding.provider;
    },

    async getToolEvents(invocation): Promise<ToolEvents> {
      const record = runtimeForInvocation(invocation);
      return record === undefined ? { state: "unavailable", reason: "snapshot-unavailable" } : record.runtime.getToolEvents(invocation);
    },

    async getUsage(invocation): Promise<InvocationUsage> {
      const record = runtimeForInvocation(invocation);
      return record === undefined ? { state: "unavailable", reason: "snapshot-unavailable" } : record.runtime.getUsage(invocation);
    },

    async getInvocationStatus(invocation): Promise<InvocationStatus> {
      const record = runtimeForInvocation(invocation);
      return record === undefined ? "unknown" : record.runtime.getInvocationStatus(invocation);
    },

    async resume(execution) {
      const record = runtimeForExecution(execution);
      return record.runtime.resume(execution);
    },

    async reconnect(execution) {
      const record = runtimeForExecution(execution);
      return record.runtime.reconnect(execution);
    },

    async release(invocation) {
      const record = runtimeForInvocation(invocation);
      if (record === undefined) return;
      await record.runtime.release?.(invocation);
      invocations.delete(invocation);
    },

    async close() {
      if (closed) return;
      closed = true;
      const unique = new Set([...executions.values()]);
      await Promise.all([...unique].map((record) => record.runtime.close?.()));
      executions.clear();
      invocations.clear();
      await options.gateway.close();
    },
  };

  return kernel;
}
