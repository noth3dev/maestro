import {
  type ExecutionKernelPort,
  type ExecutionRef,
  ExecutionKernelUnavailableError,
  type InvocationObservation,
  type InvocationRef,
  type InvocationStatus,
  type ModelIdentity,
  type SpawnCapabilities,
  type SpawnRequest,
  type SpawnedInvocation,
  type ToolEvents,
  type InvocationUsage,
  type InvocationAnswer,
  type ToolEventRef,
} from "@maestro/domain";
import { createAgentSession, SessionManager } from "prime-agent";

interface PrimeChildSnapshot {
  id: string;
  sessionName?: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  answerPreview?: string;
  error?: string;
  tokenCount?: number;
  activity?: { kind: "waiting" | "writing" | "executing"; toolName?: string };
}

interface PrimeSession {
  model?: { provider?: string; id?: string } | undefined;
  prompt(text: string): Promise<void>;
  /** Public Prime Agent SDK surface used to read the completed root reply. */
  getLastAssistantText?(): string | undefined;
  runRlmChild(prompt: string, kwargs?: Record<string, unknown>): Promise<{
    rlm_child_id: string;
    name: string;
  }>;
  cancelRlmChildRun(childId: string, reason?: string): boolean;
  abort(): Promise<void>;
  isStreaming: boolean;
  getRlmChildSnapshots(): readonly PrimeChildSnapshot[];
  handleAgentMessageHostRequest(type: string, payload?: Record<string, unknown>): unknown | Promise<unknown>;
}

export interface PrimeSessionFactory {
  create(options: { cwd: string; capabilities?: SpawnCapabilities }): Promise<{ session: PrimeSession }>;
}

type RootRecord = {
  invocation: InvocationRef;
  execution: ExecutionRef;
  name: string;
  cancelled: boolean;
  status: InvocationStatus;
  answerText?: string;
  error?: string;
};

type ChildRecord = {
  invocation: InvocationRef;
  parent: ExecutionRef;
  childId: string;
  name: string;
  cancelled: boolean;
};

const asExecutionRef = (value: string): ExecutionRef => value as ExecutionRef;
const asInvocationRef = (value: string): InvocationRef => value as InvocationRef;
const asToolEventRef = (value: string): ToolEventRef => value as ToolEventRef;

function normalizeStatus(status: PrimeChildSnapshot["status"]): InvocationStatus {
  switch (status) {
    case "done": return "succeeded";
    case "error": return "failed";
    case "cancelled": return "cancelled";
    case "queued": return "queued";
    case "running": return "running";
  }
}

export function createPrimeExecutionKernelFromFactory(factory: PrimeSessionFactory): ExecutionKernelPort {
  const sessions = new Map<ExecutionRef, PrimeSession>();
  const roots = new Map<InvocationRef, RootRecord>();
  const children = new Map<InvocationRef, ChildRecord>();
  let nextRoot = 0;
  let nextInvocation = 0;

  const nextPublicInvocation = (): InvocationRef => asInvocationRef(`invocation-${++nextInvocation}`);
  const toolEventsFor = (invocation: InvocationRef, snapshot: PrimeChildSnapshot): ToolEvents => {
    if (!snapshot.activity) {
      return { state: "unavailable", reason: "provider-does-not-expose-tool-events" };
    }
    return {
      state: "available",
      events: [{
        ref: asToolEventRef(`tool-event-${invocation}-activity`),
        kind: "activity",
        state: snapshot.activity.kind,
        ...(snapshot.activity.toolName ? { toolName: snapshot.activity.toolName } : {}),
      }],
    };
  };
  const usageFor = (snapshot: PrimeChildSnapshot): InvocationUsage =>
    typeof snapshot.tokenCount === "number"
      ? { state: "available", totalTokens: snapshot.tokenCount }
      : { state: "unknown" };
  // This pinned Prime Agent SDK build does not reliably populate a
  // completed child's reply text on its snapshot in this adapter's
  // in-process session mode; report that honestly rather than guessing.
  const answerFor = (snapshot: PrimeChildSnapshot): InvocationAnswer =>
    snapshot.answerPreview !== undefined
      ? { state: "available", text: snapshot.answerPreview }
      : { state: "unavailable", reason: "provider-does-not-expose-answer-text" };
  const snapshotFor = (child: ChildRecord): PrimeChildSnapshot | undefined =>
    sessions.get(child.parent)?.getRlmChildSnapshots().find((snapshot) => snapshot.id === child.childId);

  const unavailable = (operation: "resume" | "reconnect" | "prompt" | "sendMessage" | "getModelIdentity"): never => {
    throw new ExecutionKernelUnavailableError(operation);
  };

  return {
    async spawn(request: SpawnRequest): Promise<SpawnedInvocation> {
      if (!request.parent) {
        // A root is always bound to an existing process/repository context. The
        // public kernel supplies process.cwd() when callers omit cwd; the
        // production factory below also pins that context instead of trusting a
        // caller-provided path. Capability scoping (allowedTools/allowedSkills)
        // is only meaningful for a root spawn -- a child inherits its root's
        // already-scoped session, it cannot be independently re-scoped.
        const cwd = request.cwd ?? process.cwd();
        const { session } = await factory.create({ cwd, capabilities: request.capabilities });
        const execution = asExecutionRef(`execution-${++nextRoot}`);
        const invocation = nextPublicInvocation();
        sessions.set(execution, session);
        roots.set(invocation, {
          invocation,
          execution,
          name: request.name,
          cancelled: false,
          status: "unknown",
        });
        return { execution, invocation };
      }

      const session = sessions.get(request.parent);
      if (!session || !request.prompt) throw new Error("A child execution requires a known parent and prompt");
      const child = await session.runRlmChild(request.prompt, { name: request.name, thinking: "off" });
      const invocation = nextPublicInvocation();
      children.set(invocation, {
        invocation,
        parent: request.parent,
        childId: child.rlm_child_id,
        name: child.name,
        cancelled: false,
      });
      return { execution: request.parent, invocation };
    },

    async prompt(execution, text): Promise<void> {
      const session = sessions.get(execution);
      const root = [...roots.values()].find((item) => item.execution === execution);
      if (!session || !root) return unavailable("prompt");
      root.status = "running";
      delete root.answerText;
      delete root.error;
      try {
        await session.prompt(text);
        if (root.cancelled) return;
        root.status = "succeeded";
        const answerText = session.getLastAssistantText?.();
        if (answerText !== undefined) root.answerText = answerText;
      } catch (error) {
        if (!root.cancelled) {
          root.status = "failed";
          root.error = error instanceof Error ? error.message : String(error);
        }
        throw error;
      }
    },

    async observe(execution): Promise<readonly InvocationObservation[]> {
      const session = sessions.get(execution);
      if (!session) return [];
      const byId = new Map(session.getRlmChildSnapshots().map((child) => [child.id, child]));
      const root = [...roots.values()].find((item) => item.execution === execution);
      const rootObservation: InvocationObservation[] = root ? [{
        invocation: root.invocation,
        name: root.name,
        status: root.cancelled ? "cancelled" : root.status === "unknown" && session.isStreaming ? "running" : root.status,
        toolEvents: { state: "unavailable", reason: "provider-does-not-expose-tool-events" },
        usage: { state: "unavailable", reason: "provider-does-not-expose-usage" },
        answer: root.status === "succeeded" && root.answerText !== undefined
          ? { state: "available", text: root.answerText }
          : { state: "unavailable", reason: "provider-does-not-expose-answer-text" },
        ...(root.error ? { error: root.error } : {}),
      }] : [];
      const childObservations = [...children.values()]
        .filter((child) => child.parent === execution)
        .map((child): InvocationObservation => {
          const snapshot = byId.get(child.childId);
          if (!snapshot) {
            return {
              invocation: child.invocation,
              name: child.name,
              status: child.cancelled ? "cancelled" : "unknown",
              toolEvents: { state: "unavailable", reason: "snapshot-unavailable" },
              usage: { state: "unavailable", reason: "snapshot-unavailable" },
              answer: { state: "unavailable", reason: "snapshot-unavailable" },
            };
          }
          return {
            invocation: child.invocation,
            name: snapshot.sessionName ?? child.name,
            status: child.cancelled ? "cancelled" : normalizeStatus(snapshot.status),
            toolEvents: toolEventsFor(child.invocation, snapshot),
            usage: usageFor(snapshot),
            answer: answerFor(snapshot),
            ...(snapshot.error ? { error: snapshot.error } : {}),
          };
        });
      return [...rootObservation, ...childObservations];
    },

    async sendMessage(execution, invocation, message): Promise<void> {
      const session = sessions.get(execution);
      const child = children.get(invocation);
      if (!session || !child || child.parent !== execution) return unavailable("sendMessage");
      await session.handleAgentMessageHostRequest("agent_message.send", {
        target: child.name,
        message,
        receiverRole: "child",
      });
    },

    async cancel(invocation): Promise<{ cancelled: boolean }> {
      const root = roots.get(invocation);
      if (root) {
        if (root.cancelled) return { cancelled: false };
        const session = sessions.get(root.execution);
        if (!session) return { cancelled: false };
        await session.abort();
        root.cancelled = true;
        root.status = "cancelled";
        return { cancelled: true };
      }
      const child = children.get(invocation);
      if (!child || child.cancelled) return { cancelled: false };
      const session = sessions.get(child.parent);
      if (!session) return { cancelled: false };
      child.cancelled = session.cancelRlmChildRun(child.childId);
      return { cancelled: child.cancelled };
    },

    async getModelIdentity(execution): Promise<ModelIdentity> {
      const model = sessions.get(execution)?.model;
      if (!model?.provider || !model.id) throw new ExecutionKernelUnavailableError("getModelIdentity");
      return { provider: model.provider, id: model.id };
    },

    async getToolEvents(invocation): Promise<ToolEvents> {
      const child = children.get(invocation);
      if (!child) return { state: "unavailable", reason: "provider-does-not-expose-tool-events" };
      const snapshot = snapshotFor(child);
      return snapshot
        ? toolEventsFor(invocation, snapshot)
        : { state: "unavailable", reason: "snapshot-unavailable" };
    },

    async getUsage(invocation): Promise<InvocationUsage> {
      const child = children.get(invocation);
      if (!child) return { state: "unavailable", reason: "provider-does-not-expose-usage" };
      const snapshot = snapshotFor(child);
      return snapshot
        ? usageFor(snapshot)
        : { state: "unavailable", reason: "snapshot-unavailable" };
    },

    async getInvocationStatus(invocation): Promise<InvocationStatus> {
      const root = roots.get(invocation);
      if (root) {
        if (root.cancelled) return "cancelled";
        const session = sessions.get(root.execution);
        return root.status === "unknown" && session?.isStreaming ? "running" : root.status;
      }
      const child = children.get(invocation);
      // No provider state or terminal evidence is available for an
      // invocation this kernel never registered, or has already released --
      // "unknown" is the domain contract's exact meaning for that case.
      // Never fabricate "failed": a released invocation's real terminal
      // outcome was already durably recorded by its caller before release.
      if (!child) return "unknown";
      if (child.cancelled) return "cancelled";
      const snapshot = sessions.get(child.parent)?.getRlmChildSnapshots().find((item) => item.id === child.childId);
      return snapshot ? normalizeStatus(snapshot.status) : "unknown";
    },

    async resume(execution): Promise<never> {
      void execution;
      return unavailable("resume");
    },

    async reconnect(execution): Promise<never> {
      void execution;
      return unavailable("reconnect");
    },

    /**
     * Bounds the sessions/roots/children Maps' otherwise-unbounded growth
     * (Phase 1 re-patch item 2). Must only be called by a caller that has
     * already durably recorded this invocation's terminal outcome; this
     * kernel never evicts on its own initiative. Idempotent: releasing an
     * already-released or never-registered invocation is a safe no-op.
     */
    async release(invocation): Promise<void> {
      const root = roots.get(invocation);
      if (root) {
        roots.delete(invocation);
        const stillReferenced = [...children.values()].some((child) => child.parent === root.execution);
        if (!stillReferenced) sessions.delete(root.execution);
        return;
      }
      const child = children.get(invocation);
      if (child) children.delete(invocation);
    },
  };
}

export function createPrimeExecutionKernel(): ExecutionKernelPort {
  // Pin the real SDK session to the process' existing repository context. A
  // caller cannot redirect the production root session through SpawnRequest.cwd.
  const cwd = process.cwd();
  return createPrimeExecutionKernelFromFactory({
    async create(options) {
      return createAgentSession({
        cwd,
        sessionManager: SessionManager.inMemory(cwd),
        rlmMaxDepth: 1,
        // allowedToolNames is the real Prime Agent SDK's own tool-restriction
        // surface (packages/domain's Mission Bundle allowedTools maps to it
        // directly). Omitted entirely when no capability scoping is
        // supplied, matching the SDK's own "no restriction" default -- never
        // silently narrowed or widened.
        ...(options.capabilities?.allowedTools ? { allowedToolNames: [...options.capabilities.allowedTools] } : {}),
      });
    },
  });
}
