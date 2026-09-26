import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ModelGatewayPort, ModelIdentity } from "@maestro/agent-runtime";
import { assertValidIndependentBrief, canonicalJson, PERMANENT_DEPARTMENTS, toExecutionRef, type ExecutionKernelPort, type IndependentBrief } from "@maestro/domain";
import {
  readHeadCouncil,
  revealCouncilBriefs,
  sleepHeadParticipation,
  submitIndependentBrief,
  withdrawCouncilParticipant,
  type GoalLeaseProof,
} from "@maestro/persistence";
import { HEAD_BRIEF_SYSTEM_PROMPT, headBriefPrompt } from "@maestro/prompts";

/** A Head's sealed answer: a brief, or "my department is not needed" (it goes back to sleep). */
export type HeadBriefDecision = { readonly needed: true; readonly brief: IndependentBrief } | { readonly needed: false; readonly reason: string };

export class HeadBriefParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeadBriefParseError";
  }
}

/** The JSON object in a model reply, tolerating prose or a code fence around it. */
export function parseJsonReply(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new HeadBriefParseError("Head reply has no JSON object");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new HeadBriefParseError("Head reply is not valid JSON");
  }
}

/** Parse the Head's brief decision. */
export function parseHeadBriefDecision(text: string): HeadBriefDecision {
  const reply = parseJsonReply(text) as { needed?: unknown; reason?: unknown; brief?: unknown };
  if (reply.needed === false) {
    if (typeof reply.reason !== "string" || reply.reason.trim() === "") throw new HeadBriefParseError("A Head that is not needed must give a reason");
    return { needed: false, reason: reply.reason.trim() };
  }
  if (reply.needed !== true) throw new HeadBriefParseError("Head reply must say whether the department is needed");
  try {
    assertValidIndependentBrief(reply.brief);
  } catch (error) {
    throw new HeadBriefParseError(`Head brief is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { needed: true, brief: reply.brief };
}

export interface HeadBriefOutcome {
  readonly departmentId: string;
  readonly outcome: "submitted" | "withdrew" | "already_settled" | "failed";
  readonly detail?: string;
}

export interface HeadBriefRuntime {
  /**
   * Ask every unsettled Head of a collecting Council for its sealed brief.
   * Unneeded Heads withdraw and go back to sleep. Briefs are revealed once
   * every Head has settled with at least one brief.
   */
  run(input: { readonly goalId: string; readonly councilId: string }): Promise<{ readonly outcomes: readonly HeadBriefOutcome[]; readonly revealed: boolean }>;
}

/** One model answer for a Head. `sessionRef` is the Head's live execution from activation. */
export type HeadAsk = (input: {
  readonly goalId: string;
  readonly departmentId: string;
  readonly sessionRef: string;
  readonly system: string;
  readonly prompt: string;
}) => Promise<string>;

export interface HeadBriefRuntimeDependencies {
  readonly pool: Pool;
  readonly withGoalLease: <T>(goalId: string, operation: (proof: GoalLeaseProof) => Promise<T>) => Promise<T>;
  /** One model answer for a Head (system prompt + user prompt → text). */
  readonly ask: HeadAsk;
  /** The PRD behind the Goal's contract, when one exists. */
  readonly readPrd?: (goalId: string) => Promise<string | undefined>;
  /** Say something in #head-council as this Head (best effort; the Head must still be awake). */
  readonly post?: (input: { readonly goalId: string; readonly departmentId: string; readonly headRoleId: string; readonly content: string }) => Promise<void>;
}

const RUNTIME_ACTOR = "maestro:head-council";

function departmentName(departmentId: string): string {
  return PERMANENT_DEPARTMENTS.find((department) => department.departmentId === departmentId)?.displayName ?? `${departmentId} department`;
}

export function createHeadBriefRuntime(deps: HeadBriefRuntimeDependencies): HeadBriefRuntime {
  const say = async (goalId: string, departmentId: string, headRoleId: string, content: string) => {
    try {
      await deps.post?.({ goalId, departmentId, headRoleId, content });
    } catch {
      // The channel is a window onto the meeting, not part of the protocol.
    }
  };

  async function settledDepartments(councilId: string): Promise<Set<string>> {
    const rows = await deps.pool.query<{ department_id: string }>(
      `SELECT p.department_id FROM council_participants p
       WHERE p.council_id = $1
         AND (p.absent_at IS NOT NULL OR p.withdrawn_at IS NOT NULL
              OR EXISTS (SELECT 1 FROM independent_briefs b WHERE b.council_id = p.council_id AND b.department_id = p.department_id))`,
      [councilId],
    );
    return new Set(rows.rows.map((row) => row.department_id));
  }

  return {
    async run({ goalId, councilId }) {
      const council = await readHeadCouncil(deps.pool, councilId);
      if (council.goalId !== goalId) throw new Error("Council does not belong to this Goal");
      if (council.state !== "collecting") return { outcomes: [], revealed: true };
      const participants = council.snapshot.participants.filter((entry) => entry.departmentId !== undefined && entry.headRoleId !== undefined);
      const settled = await settledDepartments(councilId);
      const prd = await deps.readPrd?.(goalId);
      const contractJson = canonicalJson(council.snapshot.contract.content);

      const outcomes = await Promise.all(
        participants.map(async (participant): Promise<HeadBriefOutcome> => {
          const departmentId = participant.departmentId!;
          if (settled.has(departmentId)) return { departmentId, outcome: "already_settled" };
          const context = { actorId: participant.headRoleId!, sessionRef: participant.sessionRef, commandId: randomUUID() };
          try {
            const text = await deps.ask({
              goalId,
              departmentId,
              sessionRef: participant.sessionRef,
              system: HEAD_BRIEF_SYSTEM_PROMPT,
              prompt: headBriefPrompt({
                departmentId,
                departmentName: departmentName(departmentId),
                otherDepartments: participants.map((entry) => entry.departmentId!).filter((id) => id !== departmentId),
                contractJson,
                ...(prd === undefined ? {} : { prd }),
              }),
            });
            const decision = parseHeadBriefDecision(text);
            if (decision.needed) {
              await deps.withGoalLease(goalId, (proof) => submitIndependentBrief(deps.pool, councilId, departmentId, decision.brief, proof, context));
              await say(goalId, departmentId, participant.headRoleId!, "Sealed brief submitted. It opens when every Head has settled.");
              return { departmentId, outcome: "submitted" };
            }
            await say(goalId, departmentId, participant.headRoleId!, `Not needed for this Goal: ${decision.reason} Going back to sleep.`);
            await deps.withGoalLease(goalId, async (proof) => {
              await withdrawCouncilParticipant(deps.pool, councilId, departmentId, decision.reason, proof, context);
              await sleepHeadParticipation(deps.pool, goalId, departmentId, proof, participant.headRoleId);
            });
            return { departmentId, outcome: "withdrew", detail: decision.reason };
          } catch (error) {
            return { departmentId, outcome: "failed", detail: error instanceof Error ? error.message : String(error) };
          }
        }),
      );

      const nowSettled = await settledDepartments(councilId);
      const briefs = await deps.pool.query<{ count: number }>("SELECT count(*)::int AS count FROM independent_briefs WHERE council_id = $1", [councilId]);
      const everyoneSettled = participants.every((entry) => nowSettled.has(entry.departmentId!));
      if (!everyoneSettled || briefs.rows[0]!.count === 0) return { outcomes, revealed: false };
      await deps.withGoalLease(goalId, (proof) =>
        revealCouncilBriefs(deps.pool, councilId, proof, { actorId: RUNTIME_ACTOR, sessionRef: "head-brief-runtime", commandId: randomUUID() }),
      );
      return { outcomes, revealed: true };
    },
  };
}

/**
 * Head answers through the Model Gateway, on the model of the Concertmaster
 * session whose PRD became the Goal's contract.
 */
export function createGatewayHeadAsk(options: {
  readonly gateway: ModelGatewayPort;
  readonly gatewayOperatorId: string;
  readonly accountRefs: Readonly<Record<string, string>>;
  readonly dataPolicyHash: string;
  readonly readGoalModel: (goalId: string) => Promise<ModelIdentity>;
}): HeadAsk {
  return async ({ goalId, departmentId, system, prompt }) => {
    const model = await options.readGoalModel(goalId);
    const accountRef = options.accountRefs[model.provider];
    if (accountRef === undefined) throw new Error(`No account is configured for provider ${model.provider}`);
    const requestId = randomUUID();
    const binding = await options.gateway.admit({
      requestId,
      operatorId: options.gatewayOperatorId,
      providerId: model.provider,
      model,
      accountRef,
      dataPolicyHash: options.dataPolicyHash,
    });
    const result = await options.gateway.turn({
      binding,
      requestId,
      sessionId: `head-${departmentId}-${goalId}`,
      turnId: `${requestId}-brief`,
      messages: [
        { role: "system", content: [{ kind: "text", text: system }] },
        { role: "user", content: [{ kind: "text", text: prompt }] },
      ],
      tools: [],
      limits: {
        maxModelTurns: 1,
        maxToolCalls: 0,
        maxChildCalls: 0,
        maxOutputTokens: 4_000,
        maxInputBytes: 400_000,
        maxResultBytes: 64_000,
        providerTimeoutMs: 240_000,
        wallTimeMs: 300_000,
      },
      signal: AbortSignal.timeout(300_000),
      emit: () => undefined,
    });
    if (result.stopReason === "error" || result.text.trim() === "") throw new Error(`Head ${departmentId} returned no answer (${result.stopReason})`);
    return result.text;
  };
}

/**
 * Head answers inside the Head's own execution (spawned at activation), so the
 * Head keeps its context from brief to meeting to planning.
 */
export function createKernelHeadAsk(kernel: Pick<ExecutionKernelPort, "prompt" | "observe">): HeadAsk {
  return async ({ departmentId, sessionRef, system, prompt }) => {
    const execution = toExecutionRef(sessionRef);
    await kernel.prompt(execution, `${system}\n\n${prompt}`);
    const latest = (await kernel.observe(execution)).at(-1);
    if (latest === undefined || latest.status !== "succeeded" || latest.answer.state !== "available" || latest.answer.text.trim() === "")
      throw new Error(`Head ${departmentId} returned no answer`);
    return latest.answer.text;
  };
}

/** Try the Head's own execution; if it is gone (e.g. after a restart), answer with a one-shot call. */
export function headAskWithFallback(primary: HeadAsk, fallback: HeadAsk): HeadAsk {
  return async (input) => {
    try {
      return await primary(input);
    } catch {
      return fallback(input);
    }
  };
}

/** The model of the Concertmaster session whose Overture run produced the Goal's contract. */
export async function readGoalLaunchModel(pool: Pool, goalId: string): Promise<ModelIdentity> {
  const row = await pool.query<{ model_provider: string; model_id: string }>(
    `SELECT c.model_provider, c.model_id
       FROM goals g
       JOIN overture_runs r ON r.task_contract_id = g.task_contract_id
       JOIN conversations c ON c.conversation_id = r.conversation_id
      WHERE g.goal_id = $1
      ORDER BY r.updated_at DESC
      LIMIT 1`,
    [goalId],
  );
  const found = row.rows[0];
  if (found === undefined) throw new Error("No launching session model for this Goal");
  return { provider: found.model_provider, id: found.model_id } as ModelIdentity;
}
