import { maestroSystemPrompt } from "@maestro/prompts";
import { CONCERTMASTER_PERSONA_BASELINE, PERSONA_AXES, parsePersonaProfile, type PersonaAxis, type PersonaProfile } from "@maestro/domain";

export interface MaestroPersonaContext {
  readonly roleId: string;
  readonly taskClass: string;
  readonly profile: PersonaProfile;
  readonly mission: string;
  readonly authority: readonly string[];
  readonly truthfulness: string;
  readonly safety: string;
  readonly prohibitedBehavior: readonly string[];
}

export const DEFAULT_CONCERTMASTER_PERSONA: MaestroPersonaContext = Object.freeze({
  roleId: "concertmaster",
  taskClass: "conversation",
  profile: CONCERTMASTER_PERSONA_BASELINE,
  mission: "Coordinate the Secretary Office on behalf of the CEO while preserving intent and canonical records.",
  authority: Object.freeze(["coordinate the Secretary Office", "maintain canonical records", "present CEO decisions"]),
  truthfulness: "report evidence accurately",
  safety: "preserve safety and escalation boundaries",
  prohibitedBehavior: Object.freeze([
    "change CEO intent without confirmation",
    "execute unapproved critical actions",
    "spawn production workers directly",
  ]),
});

/** Fallback policy for non-conversation runtimes; worker persona details follow it when assigned. */
export const DEFAULT_MAESTRO_RUNTIME_PERSONA: MaestroPersonaContext = Object.freeze({
  roleId: "maestro-runtime",
  taskClass: "runtime",
  profile: CONCERTMASTER_PERSONA_BASELINE,
  mission: "Execute only work admitted by Maestro's host-controlled runtime.",
  authority: Object.freeze(["use host-provided capabilities within the admitted grant"]),
  truthfulness: "report only host-observed execution state",
  safety: "preserve host approval, scope, and cancellation boundaries",
  prohibitedBehavior: Object.freeze(["invent authority or execution results", "bypass host controls"]),
});

const MAX_PROMPT_LINE_LENGTH = 2_000;
const MAX_SYSTEM_PROMPT_BYTES = 16_000;

function promptLine(value: string, field: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_PROMPT_LINE_LENGTH || /[\r\n]/.test(value))
    throw new Error(`Maestro persona ${field} is invalid`);
  return value;
}

function promptList(values: readonly string[], field: string): string {
  if (!Array.isArray(values) || values.length === 0 || values.length > 32) throw new Error(`Maestro persona ${field} is invalid`);
  return values.map((value) => promptLine(value, field)).join("; ");
}

function personaLines(profile: PersonaProfile): string {
  const parsed = parsePersonaProfile(profile);
  return PERSONA_AXES.map((axis: PersonaAxis) => `${axis}=${parsed[axis].toFixed(2)}`).join(", ");
}

/** Builds host-owned model guidance from the reviewed Maestro persona boundary. */
export function buildMaestroSystemPrompt(persona: MaestroPersonaContext = DEFAULT_CONCERTMASTER_PERSONA): string {
  const roleId = promptLine(persona.roleId, "roleId");
  const taskClass = promptLine(persona.taskClass, "taskClass");
  const mission = promptLine(persona.mission, "mission");
  const authority = promptList(persona.authority, "authority");
  const truthfulness = promptLine(persona.truthfulness, "truthfulness");
  const safety = promptLine(persona.safety, "safety");
  const prohibited = promptList(persona.prohibitedBehavior, "prohibitedBehavior");
  const prompt = maestroSystemPrompt({
    roleId,
    taskClass,
    mission,
    authority,
    personaProfile: personaLines(persona.profile),
    truthfulness,
    safety,
    prohibited,
  });
  if (Buffer.byteLength(prompt, "utf8") > MAX_SYSTEM_PROMPT_BYTES) throw new Error("Maestro persona system prompt is too large");
  return prompt;
}
