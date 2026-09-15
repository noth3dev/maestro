import { performance } from "node:perf_hooks";
import type { ProjectionNode, ProjectionReadModel } from "@maestro/contracts";
import { buildRadialLayout } from "../../apps/carnegie/src/views/panels/radial/radial-layout.js";

type Distribution = { readonly p50: number; readonly p95: number; readonly max: number };

export interface RadialGraphLargePortfolioBaseline {
  readonly metric: "radial-graph-large-portfolio";
  readonly database: "runtime";
  readonly scope: "layout-and-node-behavior";
  readonly sampleCount: number;
  readonly layoutMs: Distribution;
  readonly portfolio: { readonly goals: number; readonly sectorsPerGoal: number; readonly workersPerSector: number; readonly sourceNodes: number };
  readonly behavior: { readonly virtualizedFlagSamples: number; readonly sourceIdentityPreserved: boolean; readonly criticalBlockersRetained: boolean };
}

const GOAL_COUNT = 24;
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const goalIdFor = (index: number) => `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`;
const SECTORS = ["product", "engineering", "quality", "operations", "research"] as const;
const WORKERS_PER_SECTOR = 2;
const SAMPLE_COUNT = 10;

function percentile(samples: readonly number[], quantile: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]!;
}

function distribution(samples: readonly number[]): Distribution {
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), max: Math.max(...samples) };
}

function node(overrides: Partial<ProjectionNode> & Pick<ProjectionNode, "nodeId" | "kind" | "goalId" | "sectorId" | "sourceKey">): ProjectionNode {
  const { nodeId, kind, goalId, sectorId, sourceKey, ...rest } = overrides;
  return {
    nodeId,
    kind,
    projectId: PROJECT_ID,
    goalId,
    parentNodeId: null,
    sectorId,
    state: "running",
    version: null,
    ownerId: null,
    crossLinks: [],
    sourceRevision: "1",
    eventCursor: "1",
    removed: false,
    sourceKey,
    ...rest,
  };
}
function largePortfolioProjection(): { readonly projection: ProjectionReadModel; readonly blockedWorkerId: string } {
  const nodes: ProjectionNode[] = [];
  let blockedWorkerId = "";
  for (let goalIndex = 0; goalIndex < GOAL_COUNT; goalIndex += 1) {
    const goalId = goalIdFor(goalIndex);
    nodes.push(node({ nodeId: goalId, kind: "goal", goalId, sectorId: "goal", sourceKey: [goalId], state: "active", version: 1 }));
    for (const sector of SECTORS) {
      const planId = `${goalId}-plan-${sector}`;
      nodes.push(node({ nodeId: planId, kind: "department_plan", goalId, parentNodeId: goalId, sectorId: sector, sourceKey: [planId], ownerId: `${sector}-head` }));
      for (let workerIndex = 0; workerIndex < WORKERS_PER_SECTOR; workerIndex += 1) {
        const workerId = `${planId}-worker-${workerIndex}`;
        const blocked = goalIndex === GOAL_COUNT - 1 && sector === "research" && workerIndex === WORKERS_PER_SECTOR - 1;
        if (blocked) blockedWorkerId = workerId;
        nodes.push(node({ nodeId: workerId, kind: "worker", goalId, parentNodeId: planId, sectorId: sector, sourceKey: [workerId], state: blocked ? "blocked" : "running" }));
      }
    }
  }
  return { projection: { eventCursor: "1", nodes, edges: [] }, blockedWorkerId };
}

export function measureRadialGraphLargePortfolio(): RadialGraphLargePortfolioBaseline {
  const { projection, blockedWorkerId } = largePortfolioProjection();
  const sourceNodeCount = projection.nodes.length;
  const blockerCount = projection.nodes.filter((candidate) => candidate.state === "blocked").length;
  const layoutTimes: number[] = [];
  let virtualizedFlagSamples = 0;
  let sourceIdentityPreserved = true;
  let criticalBlockersRetained = true;
  let observedPortfolio: RadialGraphLargePortfolioBaseline["portfolio"] | undefined;

  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    const started = performance.now();
    const layout = buildRadialLayout(projection, { selectedGoalId: goalIdFor(0), maxVisibleNodes: 48 });
    layoutTimes.push(performance.now() - started);
    if (layout.virtualized) virtualizedFlagSamples += 1;
    const sourceNodes = layout.nodes.filter((candidate) => !candidate.synthetic);
    const sourceIds = sourceNodes.map((candidate) => candidate.id);
    const sourceIdSet = new Set(sourceIds);
    const goalIds = new Set(sourceNodes.filter((candidate) => candidate.kind === "goal").map((candidate) => candidate.goalId));
    const sectorIds = new Set(layout.nodes.filter((candidate) => candidate.synthetic && candidate.kind === "sector").map((candidate) => candidate.id));
    const workerCount = sourceNodes.filter((candidate) => candidate.kind === "worker").length;
    const measuredPortfolio = {
      goals: goalIds.size,
      sectorsPerGoal: sectorIds.size / goalIds.size,
      workersPerSector: workerCount / sectorIds.size,
      sourceNodes: sourceNodes.length,
    };
    observedPortfolio ??= measuredPortfolio;
    sourceIdentityPreserved &&= sourceNodes.length === sourceNodeCount
      && sourceIdSet.size === sourceNodeCount
      && projection.nodes.every((source) => sourceNodes.some((candidate) => candidate.id === source.nodeId && candidate.sourceKey?.join("\u0000") === source.sourceKey.join("\u0000")))
      && JSON.stringify(measuredPortfolio) === JSON.stringify(observedPortfolio);
    criticalBlockersRetained &&= layout.nodes.some((candidate) => candidate.id === blockedWorkerId && candidate.state === "blocked" && candidate.collapsed !== true)
      && layout.nodes.filter((candidate) => candidate.state === "blocked").length >= blockerCount;
  }

  return {
    metric: "radial-graph-large-portfolio",
    database: "runtime",
    scope: "layout-and-node-behavior",
    sampleCount: layoutTimes.length,
    layoutMs: distribution(layoutTimes),
    portfolio: observedPortfolio!,
    behavior: { virtualizedFlagSamples, sourceIdentityPreserved, criticalBlockersRetained },
  };
}
