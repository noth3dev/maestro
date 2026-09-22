import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertValidModelMap, type ModelMap } from "@maestro/domain";

export interface ModelMapSource {
  readonly path: string;
  readonly modelMap: ModelMap;
}

export class ModelMapSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelMapSourceError";
  }
}

function candidatePaths(): readonly string[] {
  return [
    process.env.MAESTRO_MODEL_MAP,
    resolve(process.cwd(), "config/model_map.json"),
    resolve(process.cwd(), "../../config/model_map.json"),
    resolve(process.cwd(), "../../../config/model_map.json"),
  ].filter((path, index, paths): path is string => path !== undefined && path.trim() !== "" && paths.indexOf(path) === index);
}

/** Read and validate the human-owned model map without ever writing it. */
export function readModelMapSource(): ModelMapSource {
  let lastError: unknown;
  for (const path of candidatePaths()) {
    try {
      const value: unknown = JSON.parse(readFileSync(path, "utf8"));
      assertValidModelMap(value);
      return { path, modelMap: value };
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new ModelMapSourceError(`Human-owned model_map is unavailable or invalid${detail}`);
}
