import type { Pool } from "pg";
import type { ModelGatewayPort } from "@maestro/agent-runtime";
import {
  RouterConfigInputSchema,
  type RouterCatalogEntry,
  type RouterCatalogRead,
  type RouterConfigInput,
  type RouterConfigValidation,
} from "@maestro/contracts";
import { readEnabledModelRefs, createPostgresSettingsService } from "@maestro/persistence";
import { readRoutingCandidateCatalog } from "../ensemble-candidate-catalog.js";
import type { MaestroConfig } from "../config.js";
import { readModelMapSource } from "./model-map-source.js";

export interface RouterCatalogService {
  get(operatorId: string): Promise<RouterCatalogRead>;
  validate(operatorId: string, input: RouterConfigInput): Promise<RouterConfigValidation>;
  replace(operatorId: string, input: RouterConfigInput): Promise<RouterCatalogRead>;
}

export interface RouterCatalogDeps {
  pool: Pool;
  config: MaestroConfig;
  modelGateway?: ModelGatewayPort;
  settingsService: Pick<ReturnType<typeof createPostgresSettingsService>, "replaceModelPool">;
}

type GatewayModel = Awaited<ReturnType<ModelGatewayPort["listModels"]>>[number];
type Baseline = { present: true; score: number | null; reviewedAt?: string } | { present: false; score: null };
type CandidateState = { present: boolean | null; candidateRefs: string[]; accountBindings: string[] };
type LiveState = {
  present: boolean | null;
  capabilities: string[];
  authModes: ("api-key" | "managed-subscription")[];
  regions: string[];
};

interface CatalogSources {
  readonly modelMap: ReturnType<typeof readModelMapSource>["modelMap"];
  readonly candidates: readonly { candidateRef: string; modelRef: string; accountBinding: string }[];
  readonly candidateCatalogAvailable: boolean;
  readonly candidateSetReady: boolean;
  readonly liveModels: readonly GatewayModel[];
  readonly liveAvailable: boolean;
  readonly reason?: string;
}

function averageScore(entry: CatalogSources["modelMap"]["entries"][number]): number | null {
  const values = Object.values(entry.capability.axes).flatMap((axis) =>
    axis.status === "scored" && axis.score !== null ? [axis.score] : [],
  );
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function liveState(models: readonly GatewayModel[], modelRef: string, liveAvailable: boolean): LiveState {
  if (!liveAvailable) return { present: null, capabilities: [], authModes: [], regions: [] };
  const matching = models.filter((model) => `${model.identity.provider}/${model.identity.id}` === modelRef);
  if (matching.length === 0) return { present: false, capabilities: [], authModes: [], regions: [] };
  return {
    present: true,
    capabilities: uniqueSorted(matching.flatMap((model) => [...model.capabilities])),
    authModes: uniqueSorted(matching.flatMap((model) => model.authModes)) as ("api-key" | "managed-subscription")[],
    regions: uniqueSorted(matching.flatMap((model) => model.dataPolicy.regions)),
  };
}

function baselineState(modelMap: CatalogSources["modelMap"], modelRef: string): Baseline {
  const entry = modelMap.entries.find((candidate) => candidate.modelRef === modelRef);
  return entry === undefined
    ? { present: false, score: null }
    : { present: true, score: averageScore(entry), reviewedAt: entry.provenance.reviewedAt };
}

function candidateState(candidates: CatalogSources["candidates"], modelRef: string, candidateCatalogAvailable: boolean): CandidateState {
  if (!candidateCatalogAvailable) return { present: null, candidateRefs: [], accountBindings: [] };
  const matching = candidates.filter((candidate) => candidate.modelRef === modelRef);
  if (matching.length === 0) return { present: false, candidateRefs: [], accountBindings: [] };
  return {
    present: true,
    candidateRefs: uniqueSorted(matching.map((candidate) => candidate.candidateRef)),
    accountBindings: uniqueSorted(matching.map((candidate) => candidate.accountBinding)),
  };
}

function rowState(input: {
  baseline: Baseline;
  candidate: CandidateState;
  live: LiveState;
  pool: readonly string[];
  modelRef: string;
}): RouterCatalogEntry["state"] {
  if (!input.baseline.present) return "unprofiled";
  if (input.candidate.present === null) return "candidate-unknown";
  if (!input.candidate.present) return "not-a-candidate";
  if (input.pool.length > 0 && !input.pool.includes(input.modelRef)) return "pool-disabled";
  if (input.live.present === null) return "live-unknown";
  if (!input.live.present) return "live-unavailable";
  return "catalog-ready";
}

function readCandidateCatalog(
  deps: RouterCatalogDeps,
  modelMapPath: string,
): Pick<CatalogSources, "candidates" | "candidateCatalogAvailable" | "reason"> {
  let candidates: CatalogSources["candidates"] = [];
  let candidateCatalogAvailable = false;
  let reason: string | undefined;
  if (deps.config.ensembleCandidateCatalogPath === undefined) {
    reason = "Candidate catalog is unavailable; configure it before Ensemble worker admission.";
  } else {
    try {
      candidates = readRoutingCandidateCatalog({ modelMapPath, catalogPath: deps.config.ensembleCandidateCatalogPath }).candidates;
      candidateCatalogAvailable = true;
    } catch {
      reason = "Candidate catalog is unavailable or invalid; configure it before Ensemble worker admission.";
    }
  }
  return { candidates, candidateCatalogAvailable, ...(reason === undefined ? {} : { reason }) };
}

async function readSources(deps: RouterCatalogDeps): Promise<CatalogSources> {
  let modelMap: CatalogSources["modelMap"];
  let modelMapPath: string;
  try {
    const source = readModelMapSource();
    modelMap = source.modelMap;
    modelMapPath = source.path;
  } catch {
    throw new Error("Human-owned model_map is unavailable or invalid");
  }

  const candidateSource = readCandidateCatalog(deps, modelMapPath);
  const { candidates, candidateCatalogAvailable } = candidateSource;
  let reason = candidateSource.reason;
  const addReason = (message: string) => {
    reason = reason === undefined ? message : `${reason} ${message}`;
  };

  let liveModels: readonly GatewayModel[] = [];
  let liveAvailable = false;
  if (deps.modelGateway?.listModels !== undefined) {
    try {
      liveModels = await deps.modelGateway.listModels({ operatorId: deps.config.modelGatewayOperatorId });
      liveAvailable = true;
    } catch {
      addReason("Live Gateway catalog is unavailable; provider availability cannot be confirmed.");
    }
  } else {
    addReason("Live Gateway catalog is unavailable; provider availability cannot be confirmed.");
  }

  let candidateSetReady = candidateCatalogAvailable && liveAvailable && candidates.length > 0;
  if (candidateCatalogAvailable && candidates.length === 0) {
    addReason(
      "Candidate catalog is valid but contains no candidates; Ensemble worker admission is unavailable until a candidate is configured.",
    );
  }
  if (candidateSetReady) {
    const liveRefs = new Set(liveModels.map((model) => `${model.identity.provider}/${model.identity.id}`));
    const allCandidatesLive = candidates.every((candidate) => liveRefs.has(candidate.modelRef));
    const allBindingsAuthorized = candidates.every((candidate) => {
      const separator = candidate.modelRef.indexOf("/");
      const provider = candidate.modelRef.slice(0, separator);
      return deps.config.modelAccountRefs[provider] === candidate.accountBinding;
    });
    if (!allCandidatesLive) {
      candidateSetReady = false;
      addReason("Configured candidate catalog contains models unavailable from the live Gateway.");
    } else if (!allBindingsAuthorized) {
      candidateSetReady = false;
      addReason("Configured candidate catalog contains an unauthorized account binding.");
    }
  }
  return {
    modelMap,
    candidates,
    candidateCatalogAvailable,
    candidateSetReady,
    liveModels,
    liveAvailable,
    ...(reason === undefined ? {} : { reason }),
  };
}

function buildRead(deps: RouterCatalogDeps, pool: readonly string[], sources: CatalogSources): RouterCatalogRead {
  const baselineRefs = sources.modelMap.entries.map((entry) => entry.modelRef);
  const candidateRefs = sources.candidates.map((candidate) => candidate.modelRef);
  const liveRefs = sources.liveModels.map((model) => `${model.identity.provider}/${model.identity.id}`);
  const refs = [...new Set([...baselineRefs, ...candidateRefs, ...liveRefs])];
  const entries = refs.map((modelRef): RouterCatalogEntry => {
    const baseline = baselineState(sources.modelMap, modelRef);
    const candidate = candidateState(sources.candidates, modelRef, sources.candidateCatalogAvailable);
    const live = liveState(sources.liveModels, modelRef, sources.liveAvailable);
    const separator = modelRef.indexOf("/");
    const providerId = modelRef.slice(0, separator);
    const modelId = modelRef.slice(separator + 1);
    return {
      modelRef,
      providerId,
      modelId,
      baseline,
      live,
      candidate,
      inUse: baseline.present && candidate.present === true && (pool.length === 0 || pool.includes(modelRef)),
      state: rowState({ baseline, candidate, live, pool, modelRef }),
    };
  });
  const status = !sources.candidateCatalogAvailable
    ? "inactive"
    : !sources.liveAvailable || !sources.candidateSetReady
      ? "partial"
      : "ready";
  return {
    mode: deps.config.modelRoutingMode,
    active: deps.config.modelRoutingMode === "ensemble" && status === "ready",
    status,
    ...(sources.reason === undefined ? {} : { reason: sources.reason }),
    poolModelRefs: [...pool].sort(),
    entries,
  };
}

export class RouterConfigInvalidError extends Error {
  readonly unknownModelRefs: readonly string[];
  constructor(message: string, unknownModelRefs: readonly string[]) {
    super(message);
    this.name = "RouterConfigInvalidError";
    this.unknownModelRefs = unknownModelRefs;
  }
}

export function composeRouterCatalogService(deps: RouterCatalogDeps): RouterCatalogService {
  async function get(operatorId: string): Promise<RouterCatalogRead> {
    let sources: CatalogSources;
    try {
      sources = await readSources(deps);
    } catch (error) {
      return {
        mode: deps.config.modelRoutingMode,
        active: false,
        status: "inactive",
        reason: error instanceof Error ? error.message : "Human-owned model_map is unavailable or invalid",
        poolModelRefs: [...(await readEnabledModelRefs(deps.pool, operatorId))].sort(),
        entries: [],
      };
    }
    const pool = await readEnabledModelRefs(deps.pool, operatorId);
    return buildRead(deps, pool, sources);
  }

  async function validate(operatorId: string, input: RouterConfigInput): Promise<RouterConfigValidation> {
    const parsed = RouterConfigInputSchema.parse(input);
    const modelMapSource = readModelMapSource();
    const knownRefs = new Set(modelMapSource.modelMap.entries.map((entry) => entry.modelRef));
    const candidateSource = readCandidateCatalog(deps, modelMapSource.path);
    const eligibleRefs = [
      ...new Set(candidateSource.candidates.map((candidate) => candidate.modelRef).filter((ref) => knownRefs.has(ref))),
    ].sort();
    const eligibleSet = new Set(eligibleRefs);
    const enabledModelRefs = [...parsed.enabledModelRefs].sort();
    const unknownModelRefs = enabledModelRefs.filter((modelRef) => !knownRefs.has(modelRef));
    const nonCandidateModelRefs = candidateSource.candidateCatalogAvailable
      ? enabledModelRefs.filter((modelRef) => knownRefs.has(modelRef) && !eligibleSet.has(modelRef))
      : [];
    const previousRefs = await readEnabledModelRefs(deps.pool, operatorId);
    const previousInUse = new Set(previousRefs.length === 0 ? eligibleRefs : previousRefs.filter((ref) => eligibleSet.has(ref)));
    const nextInUse = new Set(
      parsed.enabledModelRefs.length === 0 ? eligibleRefs : parsed.enabledModelRefs.filter((ref) => eligibleSet.has(ref)),
    );
    const changes = eligibleRefs
      .filter((modelRef) => previousInUse.has(modelRef) !== nextInUse.has(modelRef))
      .map((modelRef) => ({ modelRef, previousInUse: previousInUse.has(modelRef), nextInUse: nextInUse.has(modelRef) }));
    return { valid: unknownModelRefs.length === 0, enabledModelRefs, unknownModelRefs, nonCandidateModelRefs, changes };
  }

  return {
    get,
    validate,
    async replace(operatorId: string, input: RouterConfigInput): Promise<RouterCatalogRead> {
      const validation = await validate(operatorId, input);
      if (!validation.valid)
        throw new RouterConfigInvalidError("model is not present in the human-owned model_map", validation.unknownModelRefs);
      const parsed = RouterConfigInputSchema.parse(input);
      await deps.settingsService.replaceModelPool(operatorId, parsed);
      return get(operatorId);
    },
  };
}
