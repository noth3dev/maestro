import { randomUUID } from "node:crypto";
import {
  createOvertureRoleRuntime,
  type GatewayBinding,
  type ModelGatewayPort,
  type ModelIdentity,
  type ModelMessage,
  ToolRegistry,
} from "@maestro/agent-runtime";
import { OVERTURE_ROLE_DEFINITIONS, RETIRED_OVERTURE_ROLE_IDS, createOvertureRoleRuntimePolicy, type OvertureRoleId } from "@maestro/domain";
import type { OvertureMessage } from "@maestro/contracts";
import { OVERTURE_TRIAGE_SYSTEM_PROMPT, overtureJoinPrompt, overtureRoundSummaryPrompt, overtureTriagePrompt } from "@maestro/prompts";

export class OvertureProviderUnavailableError extends Error {}

export interface OvertureRoleTurnInput {
  readonly runId: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly operatorMessageId: string;
  readonly operatorId: string;
  readonly content: string;
}

/** Who is about to use tools, so tool activity can be attributed. */
export interface OvertureToolScope {
  readonly projectId: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly roleId: OvertureRoleId;
}

export interface OvertureCrewMember {
  readonly roleId: OvertureRoleId;
  /** Why this role joins, shown to the role so it answers only its part. */
  readonly reason: string;
}

export interface OvertureRoleTurnRunner {
  /** One conversation-lead reply. */
  run(input: OvertureRoleTurnInput): Promise<OvertureMessage>;
  /**
   * The lead replies, then every addressed crew member and any member the
   * crew triage judges useful right now (at most two unaddressed ones).
   */
  runCrew?(input: OvertureRoleTurnInput & { readonly assignedRoles: readonly OvertureRoleId[] }): Promise<readonly OvertureMessage[]>;
}

const LEAD: OvertureRoleId = "conversation-lead";
const MAX_VOLUNTEERS = 3;
/** Crew replies (lead included) allowed per operator message, bounding crew-to-crew exchanges. */
export const MAX_CREW_REPLIES = 8;

/** `@name` handles the operator or the crew can use to address a role. */
export const OVERTURE_ROLE_HANDLES: Readonly<Record<OvertureRoleId, readonly string[]>> = {
  "conversation-lead": ["lead", "conversation-lead", "리드"],
  "architecture-analyst": ["architecture", "architect", "architecture-analyst", "아키텍처", "설계"],
  "external-research-scout": [],
  "security-evaluator": ["security", "security-evaluator", "보안"],
  "design-mock-specialist": ["design", "designer", "design-mock-specialist", "디자인", "디자이너"],
  "task-editor": ["task", "task-editor", "editor", "태스크"],
  "plan-reviewer": ["review", "reviewer", "critic", "plan-reviewer", "리뷰", "비판"],
};

const ROLE_FOCUS: Readonly<Record<OvertureRoleId, string>> = {
  "conversation-lead": "steers the conversation, clarifies goals, and writes the overall plan",
  "architecture-analyst": "technical architecture, structure, data flow, and feasibility of anything proposed",
  "external-research-scout": "retired",
  "security-evaluator": "security, privacy, data boundaries, and abuse or failure risks in anything proposed",
  "design-mock-specialist": "UI/UX: flows, screens, copy, accessibility, and visual design in anything proposed",
  "task-editor": "turning the agreed plan into task.md and phase plans that can be launched",
  "plan-reviewer": "challenging plans for drift, gaps, unverifiable criteria, and oversized scope before they become a contract",
};

/** Roles addressed with `@handle` in a message, in roster order. */
export function addressedRoles(text: string, assigned: readonly OvertureRoleId[]): OvertureRoleId[] {
  const mentions = new Set([...text.matchAll(/@([\p{L}\p{N}_-]+)/gu)].map((match) => match[1]!.toLowerCase()));
  return assigned.filter((roleId) => OVERTURE_ROLE_HANDLES[roleId].some((handle) => mentions.has(handle.toLowerCase())));
}

/** Parse the triage answer: a JSON object `{"roles":[{"role":"...","reason":"..."}]}` anywhere in the text. */
export function parseTriage(text: string, candidates: readonly OvertureRoleId[]): OvertureCrewMember[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const roles = (parsed as { roles?: unknown } | null)?.roles;
  if (!Array.isArray(roles)) return [];
  const picked: OvertureCrewMember[] = [];
  for (const entry of roles) {
    const roleId = (entry as { role?: unknown } | null)?.role;
    const reason = (entry as { reason?: unknown } | null)?.reason;
    if (typeof roleId !== "string" || !candidates.includes(roleId as OvertureRoleId)) continue;
    if (picked.some((member) => member.roleId === roleId)) continue;
    picked.push({ roleId: roleId as OvertureRoleId, reason: typeof reason === "string" && reason.trim() !== "" ? reason.trim().slice(0, 200) : "your expertise applies" });
    if (picked.length >= MAX_VOLUNTEERS) break;
  }
  return picked;
}

function roleLabel(roleId: string): string {
  return OVERTURE_ROLE_DEFINITIONS.find((role) => role.id === roleId)?.displayName ?? roleId;
}

export function createOvertureRoleTurnRunner(options: {
  readonly gateway: ModelGatewayPort;
  readonly gatewayOperatorId: string;
  readonly accountRefs: Readonly<Record<string, string>>;
  readonly dataPolicyHash: string;
  /** Tools for one turn; a factory receives the turn's conversation scope. */
  readonly tools: ToolRegistry | ((scope: OvertureToolScope) => ToolRegistry);
  readonly readModel: (projectId: string, conversationId: string) => Promise<ModelIdentity>;
  readonly readMessages: (runId: string, projectId: string, conversationId: string) => Promise<readonly OvertureMessage[]>;
  readonly bindRoleModel: (input: { runId: string; projectId: string; roleId: OvertureRoleId; modelRef: string }) => Promise<void>;
  readonly appendRoleMessage: (input: {
    runId: string;
    projectId: string;
    conversationId: string;
    turnId: string;
    actor: OvertureRoleId;
    modelRef: string;
    content: string;
    commandId: string;
  }) => Promise<OvertureMessage>;
}): OvertureRoleTurnRunner {
  const admit = async (model: ModelIdentity) => {
    const accountRef = options.accountRefs[model.provider];
    if (accountRef === undefined) throw new OvertureProviderUnavailableError(`No account is configured for provider ${model.provider}`);
    const requestId = randomUUID();
    const binding: GatewayBinding = await options.gateway.admit({
      requestId,
      operatorId: options.gatewayOperatorId,
      providerId: model.provider,
      model,
      accountRef,
      dataPolicyHash: options.dataPolicyHash,
    });
    return { model, modelRef: `${model.provider}/${model.id}`, accountRef, binding, requestId };
  };

  // Crew messages carry their author so each role knows who said what.
  const history = async (input: OvertureRoleTurnInput): Promise<ModelMessage[]> =>
    (await options.readMessages(input.runId, input.projectId, input.conversationId))
      .filter((message) => message.messageId !== input.operatorMessageId)
      .map((message) => ({
        role: message.actor === "operator" ? "user" : "assistant",
        content: [{ kind: "text", text: message.actor === "operator" ? message.content : `[${roleLabel(message.actor)}] ${message.content}` }],
      }));

  /** Run one role prompt and return its bounded answer text. */
  const answer = async (
    input: OvertureRoleTurnInput,
    roleId: OvertureRoleId,
    prompt: string,
    override?: { systemPrompt: string; tools: ToolRegistry },
  ) => {
    const model = await options.readModel(input.projectId, input.conversationId);
    await options.bindRoleModel({ runId: input.runId, projectId: input.projectId, roleId, modelRef: `${model.provider}/${model.id}` });
    const admitted = await admit(model);
    const basePolicy = createOvertureRoleRuntimePolicy({ roleId, projectId: input.projectId, runId: input.runId, conversationId: input.conversationId });
    const policy = override === undefined ? basePolicy : { ...basePolicy, systemPrompt: override.systemPrompt, allowedTools: [] as string[], outputTokenBudget: 512 };
    const roleRuntime = createOvertureRoleRuntime({
      gateway: options.gateway,
      binding: admitted.binding,
      policy,
      modelRef: admitted.modelRef,
      tools:
        override?.tools ??
        (typeof options.tools === "function"
          ? options.tools({ projectId: input.projectId, conversationId: input.conversationId, runId: input.runId, roleId })
          : options.tools),
      closeGateway: false,
      initialMessages: await history(input),
    });
    const spawned = await roleRuntime.runtime.spawn({
      name: `overture-${roleId}-${input.runId}`,
      context: { operatorId: input.operatorId, projectId: input.projectId, missionBundleId: "overture", policyVersion: "overture-task15-v1", accountRef: admitted.accountRef },
      grant: roleRuntime.grant,
      modelPolicy: [admitted.modelRef],
      idempotencyKey: admitted.requestId,
    });
    try {
      await roleRuntime.runtime.prompt(spawned.execution, prompt);
      const observation = (await roleRuntime.runtime.observe(spawned.execution)).find((item) => item.invocation === spawned.invocation);
      const result = observation?.answer;
      if (result?.state !== "available" || result.text.trim() === "") {
        const tools = observation?.toolEvents.state === "available" ? observation.toolEvents.events.length : 0;
        const detail = observation?.error === undefined ? "" : `: ${String((observation.error as { message?: unknown }).message ?? observation.error).slice(0, 300)}`;
        throw new OvertureProviderUnavailableError(`Provider returned no bounded role answer (${observation?.status ?? "no observation"}, ${tools} tool events${detail})`);
      }
      return { text: result.text, modelRef: admitted.modelRef };
    } finally {
      await roleRuntime.runtime.release?.(spawned.invocation);
      await roleRuntime.runtime.close?.();
    }
  };

  const reply = async (input: OvertureRoleTurnInput, roleId: OvertureRoleId, prompt: string) => {
    const result = await answer(input, roleId, prompt);
    return options.appendRoleMessage({
      runId: input.runId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      turnId: input.turnId,
      actor: roleId,
      modelRef: result.modelRef,
      content: result.text,
      commandId: randomUUID(),
    });
  };

  const triage = async (input: OvertureRoleTurnInput, candidates: readonly OvertureRoleId[]): Promise<OvertureCrewMember[]> => {
    if (candidates.length === 0) return [];
    try {
      const prompt = overtureTriagePrompt(input.content, candidates.map((roleId) => ({ roleId, focus: ROLE_FOCUS[roleId] })));
      const result = await answer(input, LEAD, prompt, { systemPrompt: OVERTURE_TRIAGE_SYSTEM_PROMPT, tools: new ToolRegistry() });
      return parseTriage(result.text, candidates);
    } catch {
      // Triage is advisory: without it only the lead and addressed roles speak.
      return [];
    }
  };

  return {
    run: (input) => reply(input, LEAD, input.content),
    async runCrew(input) {
      const messages: OvertureMessage[] = [];
      const lead = await reply(input, LEAD, input.content);
      messages.push(lead);
      const others = input.assignedRoles.filter((roleId) => roleId !== LEAD && !RETIRED_OVERTURE_ROLE_IDS.includes(roleId));
      const addressed = addressedRoles(`${input.content}\n${lead.content}`, others);
      const volunteers = await triage(input, others.filter((roleId) => !addressed.includes(roleId)));
      // Crew members can address each other with @handles; each reply may
      // queue the roles it addresses, up to MAX_CREW_REPLIES in total.
      const queue: OvertureCrewMember[] = [
        ...addressed.map((roleId) => ({ roleId, reason: "you were addressed by name" })),
        ...volunteers,
      ];
      while (queue.length > 0 && messages.length < MAX_CREW_REPLIES) {
        const member = queue.shift()!;
        const prompt = overtureJoinPrompt(input.content, roleLabel(member.roleId), member.reason);
        let message: OvertureMessage;
        try {
          message = await reply(input, member.roleId, prompt);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "unknown error";
          messages.push(
            await options.appendRoleMessage({
              runId: input.runId,
              projectId: input.projectId,
              conversationId: input.conversationId,
              turnId: input.turnId,
              actor: member.roleId,
              modelRef: lead.modelRef ?? "unknown/unknown",
              content: `I could not contribute this time: ${reason.slice(0, 300)}`,
              commandId: randomUUID(),
            }),
          );
          continue;
        }
        messages.push(message);
        for (const roleId of addressedRoles(message.content, input.assignedRoles.filter((role) => !RETIRED_OVERTURE_ROLE_IDS.includes(role)))) {
          if (roleId === member.roleId || queue.some((queued) => queued.roleId === roleId)) continue;
          queue.push({ roleId, reason: `the ${roleLabel(member.roleId)} addressed you` });
        }
      }
      // A round with specialists closes with the lead's summary and decision log.
      if (messages.some((message) => message.actor !== LEAD)) {
        try {
          messages.push(await reply(input, LEAD, overtureRoundSummaryPrompt(input.content)));
        } catch {
          // The round's replies already stand on their own without a summary.
        }
      }
      return messages;
    },
  };
}
