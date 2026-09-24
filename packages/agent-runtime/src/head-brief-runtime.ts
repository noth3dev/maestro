import {
  assertValidIndependentBrief,
  type ExecutionKernelPort,
  type ExecutionRef,
  type IndependentBrief,
  type ModelIdentity,
} from "@maestro/domain";

const MAX_HEAD_BRIEF_OUTPUT_CHARS = 64_000;

export class HeadBriefParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeadBriefParseError";
  }
}

export class HeadBriefProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeadBriefProviderUnavailableError";
  }
}

/** Parse only the strict JSON contract. Provider text is never included in errors. */
export function parseIndependentBriefText(text: string): IndependentBrief {
  if (typeof text !== "string" || text.trim() === "") throw new HeadBriefParseError("Head brief provider output is empty");
  if (text.length > MAX_HEAD_BRIEF_OUTPUT_CHARS) throw new HeadBriefParseError("Head brief provider output exceeds the bounded size");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new HeadBriefParseError("Head brief provider output is not strict JSON");
  }

  try {
    assertValidIndependentBrief(parsed);
  } catch {
    throw new HeadBriefParseError("Head brief provider output does not match IndependentBrief");
  }
  return parsed;
}

export interface HeadBriefRuntime {
  run(input: {
    readonly execution: ExecutionRef;
    readonly prompt: string;
  }): Promise<{ readonly brief: IndependentBrief; readonly model: ModelIdentity }>;
}

/**
 * Provider adapter only. It does not submit or persist a brief; callers must
 * perform the Goal-lease-bound persistence step after validating this result.
 */
export function createHeadBriefRuntime(options: {
  readonly kernel: Pick<ExecutionKernelPort, "prompt" | "observe" | "getModelIdentity">;
}): HeadBriefRuntime {
  return {
    async run(input) {
      if (input.prompt.trim() === "") throw new HeadBriefProviderUnavailableError("Head brief prompt is empty");
      const model = await options.kernel.getModelIdentity(input.execution);
      if (model.provider.trim() === "" || model.id.trim() === "")
        throw new HeadBriefProviderUnavailableError("Head brief provider returned no model identity");
      await options.kernel.prompt(input.execution, input.prompt);
      const observations = await options.kernel.observe(input.execution);
      const latest = observations.at(-1);
      if (latest === undefined || latest.status !== "succeeded" || latest.answer.state !== "available" || latest.answer.text.trim() === "")
        throw new HeadBriefProviderUnavailableError("Head brief provider returned no successful answer");
      return { brief: parseIndependentBriefText(latest.answer.text), model };
    },
  };
}
