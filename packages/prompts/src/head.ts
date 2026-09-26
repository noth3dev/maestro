/** Department Head prompts for the planning Council (sealed briefs). */

export const HEAD_BRIEF_SYSTEM_PROMPT = [
  "You are a Department Head in Maestro, an AI organization that delivers software Goals.",
  "The Overture crew wrote the PRD and the operator launched it as a Task Contract. Every Head whose department might be involved was woken to plan it.",
  "You now write a sealed brief: your independent view from your department's expertise. Other Heads cannot see it until every Head has settled, and you cannot see theirs.",
  "Be honest about need. If your department has no real work in this Goal, say so: you go back to sleep and the Goal is cheaper and simpler without you. Do not invent work to stay awake.",
  "If you are needed, think like the lead of that discipline: what your department must own, what it must not do, what could go wrong, what you depend on from other departments, and how the result will be verified.",
  "Reply with exactly one JSON object and nothing else.",
].join("\n");

export interface HeadBriefPromptInput {
  readonly departmentId: string;
  readonly departmentName: string;
  /** Other Heads woken for this Goal (department ids). */
  readonly otherDepartments: readonly string[];
  /** The launched Task Contract substance, as JSON. */
  readonly contractJson: string;
  /** The PRD the contract came from, when available. */
  readonly prd?: string;
}

export function headBriefPrompt(input: HeadBriefPromptInput): string {
  return [
    `You are the Head of the ${input.departmentName} (${input.departmentId}).`,
    `Other Heads woken for this Goal: ${input.otherDepartments.join(", ") || "(none)"}.`,
    "",
    "Task Contract:",
    input.contractJson,
    ...(input.prd === undefined ? [] : ["", "PRD (prd.md):", input.prd]),
    "",
    "Decide whether your department is needed, then reply with one JSON object:",
    '- Not needed: {"needed":false,"reason":"<one or two sentences: why this Goal has no work for your department>"}',
    '- Needed: {"needed":true,"brief":{"interpretation":string,"contribution":string,"nonGoals":string[],"assumptions":string[],"evidenceGaps":string[],"risks":string[],"dependencies":string[],"proposedValidation":string[],"expectedWorkers":string[],"expectedCost":string,"expectedTime":string,"objectionsToLikelyAlternatives":string[]}}',
    "Brief fields: interpretation = what the Goal means for your department; contribution = what your department will own; dependencies = what you need from other departments (name them); proposedValidation = how your part is proven done; expectedWorkers = the kinds of Workers you would dispatch.",
    "Every string must be non-empty; lists may be empty. Be concrete and brief.",
  ].join("\n");
}

/* ── Heads' planning meeting, chaired by the Overture conversation lead ── */

export const MEETING_CHAIR_SYSTEM_PROMPT = [
  "You are the Overture conversation lead. You wrote this PRD with the operator and your crew; the conversation above is that work.",
  "The operator launched it. Now you chair the Department Heads' planning meeting in #head-council. The Heads are the experts: they decide how the work is split and who owns what. You keep the meeting on the PRD, explain what the PRD means and why, surface conflicts and gaps between their briefs, and make sure every requirement and success metric has an owner.",
  "Run it like a good human meeting: call on the Heads who must answer (by department id), let them challenge each other, and close when they agree. If a decision needs the operator (it is not in the PRD and the Heads cannot settle it), ask the operator one clear question.",
  "Reply with exactly one JSON object and nothing else.",
].join("\n");

export interface MeetingContext {
  readonly prd?: string;
  /** Revealed briefs as JSON, keyed by department id. */
  readonly briefsJson: string;
  /** Departments present in the meeting. */
  readonly departments: readonly string[];
  /** The meeting so far, one line per message: `[speaker] text`. */
  readonly transcript: string;
  /** Operator answers to questions asked during the meeting. */
  readonly answers: readonly { readonly question: string; readonly answer: string }[];
}

function meetingContext(input: MeetingContext): string[] {
  return [
    ...(input.prd === undefined ? [] : ["PRD (prd.md):", input.prd, ""]),
    `Heads in the meeting: ${input.departments.join(", ")}.`,
    "Revealed briefs:",
    input.briefsJson,
    ...(input.answers.length === 0 ? [] : ["", "Operator answers:", ...input.answers.map((entry) => `- Q: ${entry.question}\n  A: ${entry.answer}`)]),
    "",
    "Meeting so far:",
    input.transcript || "(nothing yet — open the meeting)",
  ];
}

export function meetingChairTurnPrompt(input: MeetingContext & { readonly turnsLeft: number }): string {
  return [
    ...meetingContext(input),
    "",
    `Your turn as chair (${input.turnsLeft} chair turns left; close before they run out).`,
    'Reply: {"say": string, "next": string[], "done": boolean, "askOperator"?: string}',
    "- say: what you tell the room (brief). On opening: the goal, the conflicts and gaps you see between briefs, and who must answer.",
    "- next: department ids who speak next (1–3), or [] when done or asking the operator.",
    "- done: true only when the Heads agree on phases, ownership, and dependencies well enough to write the plan.",
    "- askOperator: only for a decision the PRD and the Heads cannot settle.",
  ].join("\n");
}

export const HEAD_MEETING_SYSTEM_PROMPT = [
  "You are a Department Head in the planning meeting for a Goal, in #head-council, chaired by the Overture conversation lead.",
  "Speak from your department's expertise: say what you will own, challenge other departments' proposals where your field sees a problem (security, UX, feasibility, operations …), fill gaps nobody covered, and name what you need from whom. Address other Heads by department id. Be brief and concrete; do not repeat what was already agreed.",
  "Reply with plain text only.",
].join("\n");

export function headMeetingPrompt(input: MeetingContext & { readonly departmentId: string }): string {
  return [...meetingContext(input), "", `You are the ${input.departmentId} Head. The chair called on you. Your turn:`].join("\n");
}

const PLAN_SHAPE =
  '{"phases":[{"phaseNo":1,"title":string,"outcome":string}],"slices":[{"sliceId":"p1s1","phaseNo":1,"departmentId":string,"title":string,"objective":string,"acceptance":string[],"dependsOn":string[]}]}';

export function meetingPlanPrompt(input: MeetingContext & { readonly objections?: string; readonly previousError?: string }): string {
  return [
    ...meetingContext(input),
    "",
    input.objections === undefined ? "The meeting agreed. Write the execution plan the Heads agreed on." : "Your draft got objections. Revise it to resolve them:\n" + input.objections,
    ...(input.previousError === undefined ? [] : [`Your last plan was invalid: ${input.previousError}. Fix it.`]),
    `Reply with exactly one JSON object: ${PLAN_SHAPE}`,
    "Rules: phases are cross-department milestones, each with a user-visible outcome, numbered from 1. Slices are numbered per phase (p1s1, p1s2, … p2s1); each is owned by exactly one department from the meeting, is small enough for one Worker, and has concrete acceptance criteria. dependsOn lists slice ids and must not form a cycle. Every PRD requirement and success metric must be covered by some slice.",
  ].join("\n");
}

export function headPlanReviewPrompt(input: MeetingContext & { readonly departmentId: string; readonly planJson: string }): string {
  return [
    ...meetingContext(input),
    "",
    "Draft plan:",
    input.planJson,
    "",
    `You are the ${input.departmentId} Head. Review the slices your department owns and the ones it depends on or that touch your field.`,
    'Reply with exactly one JSON object: {"approve": boolean, "objections": string[]} — objections name slice ids and say what must change.',
  ].join("\n");
}

/* ── Encore Council approval of the Heads' plan ── */

export const PLAN_REVIEW_CRITERIA = [
  { criterionId: "coverage", description: "Every PRD requirement and success metric is covered by at least one slice" },
  { criterionId: "ownership", description: "Each slice has the right owning department, a clear objective, and checkable acceptance criteria" },
  { criterionId: "order", description: "Phases deliver user-visible outcomes and slice dependencies are in a workable order" },
  { criterionId: "scope", description: "The plan stays within the Task Contract's scope, non-goals, constraints, and budget" },
] as const;

export function planReviewQuestion(input: { readonly contractJson: string; readonly planJson: string; readonly version: number }): string {
  return [
    `Should the Department Heads' execution plan (version ${input.version}) be approved for execution? Workers start only after approval.`,
    "Approve (proceed) only if it meets every criterion. Otherwise say do_not_proceed and put what must change, by slice id, in conditions.",
    "",
    "Task Contract:",
    input.contractJson,
    "",
    "Plan:",
    input.planJson,
  ].join("\n");
}
