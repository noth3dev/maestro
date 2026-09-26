import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { assertValidGoalPlan, type GoalPlanSubstance } from "@maestro/domain";
import { createGoalPlanVersion, getChannel, listOvertureClarifications, postChannelMessage, openOvertureClarification, readHeadCouncil, readRevealedCouncilBriefs } from "@maestro/persistence";
import {
  HEAD_MEETING_SYSTEM_PROMPT,
  MEETING_CHAIR_SYSTEM_PROMPT,
  headMeetingPrompt,
  headPlanReviewPrompt,
  meetingChairTurnPrompt,
  meetingPlanPrompt,
  type MeetingContext,
} from "@maestro/prompts";
import { parseJsonReply, type HeadAsk } from "./head-brief-runtime.js";

/** The Overture run whose PRD became this Goal; its conversation lead chairs the meeting. */
export interface LaunchRun {
  readonly runId: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly operatorId: string;
}

export interface MeetingChannel {
  /** #head-council so far, oldest first. `speaker` is a department id or "chair". */
  read(goalId: string): Promise<readonly { readonly speaker: string; readonly content: string; readonly messageId?: string; readonly replyTo?: string }[]>;
  /** Returns the posted message id (to reply to it). */
  post(goalId: string, author: { readonly kind: "head" | "role"; readonly id: string }, content: string, replyTo?: string): Promise<string | undefined>;
}

export interface HeadMeetingDependencies {
  readonly pool: Pool;
  readonly askHead: HeadAsk;
  /** The run's conversation lead, with its crew history, under another brief. */
  readonly askLead: (input: LaunchRun & { readonly systemPrompt: string; readonly prompt: string }) => Promise<string>;
  readonly channel: MeetingChannel;
  readonly readPrd?: (goalId: string) => Promise<string | undefined>;
  readonly maxChairTurns?: number;
}

export type HeadMeetingOutcome = "planned" | "waiting_for_operator";

const QUESTION_PREFIX = "[Heads' meeting] ";
const CHAIR = { kind: "role", id: "conversation-lead" } as const;

export async function readLaunchRun(pool: Pick<Pool, "query">, goalId: string): Promise<LaunchRun> {
  const row = await pool.query<{ run_id: string; project_id: string; conversation_id: string; operator_id: string }>(
    `SELECT r.run_id, r.project_id, r.conversation_id, c.operator_id
       FROM goals g
       JOIN overture_runs r ON r.task_contract_id = g.task_contract_id
       JOIN conversations c ON c.conversation_id = r.conversation_id
      WHERE g.goal_id = $1
      ORDER BY r.updated_at DESC LIMIT 1`,
    [goalId],
  );
  const found = row.rows[0];
  if (found === undefined) throw new Error("This Goal did not come from an Overture PRD; there is no lead to chair its meeting");
  return { runId: found.run_id, projectId: found.project_id, conversationId: found.conversation_id, operatorId: found.operator_id };
}

function chairTurn(text: string, departments: readonly string[]): { say: string; next: string[]; done: boolean; askOperator?: string } {
  let reply: { say?: unknown; next?: unknown; done?: unknown; askOperator?: unknown };
  try {
    reply = parseJsonReply(text) as typeof reply;
  } catch {
    return { say: text.trim(), next: [], done: false };
  }
  const next = Array.isArray(reply.next) ? reply.next.filter((id): id is string => typeof id === "string" && departments.includes(id)).slice(0, 3) : [];
  return {
    say: typeof reply.say === "string" ? reply.say.trim() : "",
    next,
    done: reply.done === true,
    ...(typeof reply.askOperator === "string" && reply.askOperator.trim() !== "" ? { askOperator: reply.askOperator.trim() } : {}),
  };
}

function planFrom(text: string, departments: readonly string[]): GoalPlanSubstance {
  const plan = parseJsonReply(text);
  assertValidGoalPlan(plan);
  const outsider = plan.slices.find((slice) => !departments.includes(slice.departmentId));
  if (outsider !== undefined) throw new Error(`${outsider.sliceId} is owned by ${outsider.departmentId}, which is not in the meeting`);
  return plan;
}

/**
 * The Heads' planning meeting in #head-council: the Overture conversation
 * lead chairs a free discussion, drafts the plan, the Heads review their
 * slices, and the (revised) plan is stored as the Goal's draft plan.
 */
export function createHeadMeetingRuntime(deps: HeadMeetingDependencies) {
  const maxChairTurns = deps.maxChairTurns ?? 12;

  /** Everything a meeting turn needs: the room, its record, and the lead's and Heads' voices. */
  async function session(goalId: string, councilId: string) {
      const council = await readHeadCouncil(deps.pool, councilId);
      const briefs = await readRevealedCouncilBriefs(deps.pool, councilId);
      const departments = briefs.map((entry) => entry.departmentId);
      const heads = new Map(
        council.snapshot.participants
          .filter((entry) => entry.departmentId !== undefined && departments.includes(entry.departmentId))
          .map((entry) => [entry.departmentId!, { sessionRef: entry.sessionRef, headRoleId: entry.headRoleId! }] as const),
      );
      const run = await readLaunchRun(deps.pool, goalId);
      const questions = (await listOvertureClarifications(deps.pool, run.runId)).filter((entry) => entry.question.startsWith(QUESTION_PREFIX));

      const prd = await deps.readPrd?.(goalId);
      const briefsJson = JSON.stringify(Object.fromEntries(briefs.map((entry) => [entry.departmentId, entry.brief])), null, 1);
      const answers = questions.filter((entry) => entry.answer !== null).map((entry) => ({ question: entry.question.slice(QUESTION_PREFIX.length), answer: entry.answer! }));
      const transcript: { speaker: string; content: string; messageId?: string; replyTo?: string }[] = [...(await deps.channel.read(goalId))];
      const speakerOf = (messageId: string | undefined) => transcript.find((line) => line.messageId !== undefined && line.messageId === messageId)?.speaker;
      const context = (): MeetingContext => ({
        ...(prd === undefined ? {} : { prd }),
        briefsJson,
        departments,
        answers,
        transcript: transcript
          .map((line) => {
            const to = speakerOf(line.replyTo);
            return `[${line.speaker}${to === undefined ? "" : ` → ${to}`}] ${line.content}`;
          })
          .join("\n"),
      });
      const say = async (speaker: string, author: { kind: "head" | "role"; id: string }, content: string, replyTo?: string) => {
        const messageId = await deps.channel.post(goalId, author, content, replyTo);
        transcript.push({ speaker, content, ...(messageId === undefined ? {} : { messageId }), ...(replyTo === undefined ? {} : { replyTo }) });
        return messageId;
      };
      const lead = (systemPrompt: string, prompt: string) => deps.askLead({ ...run, systemPrompt, prompt });
      const head = (departmentId: string, system: string, prompt: string) =>
        deps.askHead({ goalId, departmentId, sessionRef: heads.get(departmentId)!.sessionRef, system, prompt });
      const draft = async (objections?: string): Promise<GoalPlanSubstance> => {
        let previousError: string | undefined;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const text = await lead(MEETING_CHAIR_SYSTEM_PROMPT, meetingPlanPrompt({ ...context(), ...(objections === undefined ? {} : { objections }), ...(previousError === undefined ? {} : { previousError }) }));
          try {
            return planFrom(text, departments);
          } catch (error) {
            previousError = error instanceof Error ? error.message : String(error);
          }
        }
        throw new Error(`The lead could not write a valid plan: ${previousError}`);
      };
      const store = async (plan: GoalPlanSubstance) => {
        const goal = await deps.pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
        return createGoalPlanVersion(deps.pool, { goalId, projectId: goal.rows[0]!.project_id, councilId, plan, commandId: randomUUID() });
      };
      return { run, questions, departments, heads, transcript, context, say, lead, head, draft, store };
  }

  return {
    async run({ goalId, councilId }: { readonly goalId: string; readonly councilId: string }): Promise<HeadMeetingOutcome> {
      const existing = await deps.pool.query("SELECT 1 FROM goal_plans WHERE council_id = $1 LIMIT 1", [councilId]);
      if (existing.rowCount === 1) return "planned";
      const { run, questions, departments, heads, transcript, context, say, lead, head, draft, store } = await session(goalId, councilId);
      if (questions.some((entry) => entry.status === "open")) return "waiting_for_operator";

      // Free discussion, chaired by the lead.
      for (;;) {
        const chairTurns = transcript.filter((line) => line.speaker === "chair").length;
        if (chairTurns >= maxChairTurns) break;
        const turn = chairTurn(await lead(MEETING_CHAIR_SYSTEM_PROMPT, meetingChairTurnPrompt({ ...context(), turnsLeft: maxChairTurns - chairTurns })), departments);
        const chairMessage = turn.say === "" ? undefined : await say("chair", CHAIR, turn.say);
        if (turn.askOperator !== undefined) {
          await openOvertureClarification(deps.pool, { ...run, question: `${QUESTION_PREFIX}${turn.askOperator}`, commandId: randomUUID() });
          await say("chair", CHAIR, `Asked the operator: ${turn.askOperator} The meeting resumes when they answer.`);
          return "waiting_for_operator";
        }
        if (turn.done) break;
        for (const departmentId of turn.next) {
          const reply = (await head(departmentId, HEAD_MEETING_SYSTEM_PROMPT, headMeetingPrompt({ ...context(), departmentId }))).trim();
          if (reply !== "") await say(departmentId, { kind: "head", id: heads.get(departmentId)!.headRoleId }, reply, chairMessage);
        }
      }

      // The lead drafts what was agreed; each Head reviews; one revision.
      let plan = await draft();
      const planJson = JSON.stringify(plan);
      const draftMessage = await say("chair", CHAIR, `Draft plan: ${plan.phases.length} phases, ${plan.slices.length} slices. Each Head, review your slices.`);
      const reviews = await Promise.all(
        departments.map(async (departmentId) => {
          const text = await head(departmentId, HEAD_MEETING_SYSTEM_PROMPT, headPlanReviewPrompt({ ...context(), departmentId, planJson }));
          let review: { approve?: unknown; objections?: unknown };
          try {
            review = parseJsonReply(text) as typeof review;
          } catch {
            review = { approve: false, objections: [text.trim()] };
          }
          const objections = Array.isArray(review.objections) ? review.objections.filter((line): line is string => typeof line === "string" && line.trim() !== "") : [];
          return { departmentId, objections: review.approve === true && objections.length === 0 ? [] : objections };
        }),
      );
      for (const review of reviews)
        await say(review.departmentId, { kind: "head", id: heads.get(review.departmentId)!.headRoleId }, review.objections.length === 0 ? "I approve the draft." : `Objections:\n${review.objections.map((line) => `- ${line}`).join("\n")}`, draftMessage);
      const objections = reviews.flatMap((review) => review.objections.map((line) => `${review.departmentId}: ${line}`));
      if (objections.length > 0) plan = await draft(objections.join("\n"));

      const stored = await store(plan);
      await say("chair", CHAIR, `Plan v${stored.version} is drafted: ${plan.phases.length} phases, ${plan.slices.length} slices${objections.length > 0 ? `, revised for ${objections.length} objection(s)` : ""}. It goes to the Encore Council for approval.`);
      return "planned";
    },

    /** The lead writes a new plan version that resolves outside objections (e.g. the Encore Council's). */
    async revise({ goalId, councilId, objections }: { readonly goalId: string; readonly councilId: string; readonly objections: string }): Promise<number> {
      const { say, draft, store } = await session(goalId, councilId);
      const plan = await draft(objections);
      const stored = await store(plan);
      await say("chair", CHAIR, `Revised plan v${stored.version}: ${plan.phases.length} phases, ${plan.slices.length} slices. Back to the Encore Council.`);
      return stored.version;
    },
  };
}

/** #head-council for a Goal, read and written on behalf of the operator who started it. */
export function createHeadCouncilChannel(pool: Pool): MeetingChannel {
  const scope = async (goalId: string) => {
    const run = await pool.query<{ project_id: string; actor_id: string | null }>("SELECT project_id, actor_id FROM goal_orchestration_runs WHERE goal_id = $1", [goalId]);
    const owner = run.rows[0];
    if (owner?.actor_id == null) throw new Error("The Goal has no starting operator for #head-council");
    return { operatorId: owner.actor_id, projectId: owner.project_id, goalId, selector: { kind: "organization" as const, channelId: "head-council" as const } };
  };
  return {
    async read(goalId) {
      const read = await getChannel(pool, await scope(goalId));
      return read.messages.map((message) => ({
        speaker: message.author.kind === "head" ? message.author.id.replace(/^head[-:]/, "") : message.author.id === "conversation-lead" ? "chair" : message.author.kind,
        content: message.content,
        messageId: message.messageId,
        ...(message.replyToMessageId == null ? {} : { replyTo: message.replyToMessageId }),
      }));
    },
    async post(goalId, author, content, replyTo) {
      const message = await postChannelMessage(pool, { ...(await scope(goalId)), content, author, authorProof: { issuer: "channel-runtime", author }, ...(replyTo === undefined ? {} : { replyToMessageId: replyTo }) });
      return message.messageId;
    },
  };
}
