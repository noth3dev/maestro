import React, { type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard.js";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), selectGoal: vi.fn(), hasDetail: false, goalsLoading: false, goalsError: undefined as string | undefined, detailError: "gateway unavailable" as string | undefined, goals: [{ goalId: "22222222-2222-4222-8222-222222222222", state: "active", version: 1 }], selectedGoalId: "22222222-2222-4222-8222-222222222222" as string | undefined, goalsLoadedFor: { projectId: "11111111-1111-4111-8111-111111111111", refreshKey: "0" } as { projectId: string; refreshKey: string | undefined } | undefined, detailLoadedFor: { projectId: "11111111-1111-4111-8111-111111111111", goalId: "22222222-2222-4222-8222-222222222222", refreshKey: "0" } as { projectId: string; goalId: string; refreshKey: string } | undefined }));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: () => undefined,
    useState: (initial: unknown) => [initial, vi.fn()],
  };
});
vi.mock("../icons.js", () => ({ Icon: () => null }));
vi.mock("../components/EmptyState.js", () => ({ EmptyState: () => <div>empty</div> }));
vi.mock("../i18n/index.js", () => ({ useT: () => ({ common: { loading: "loading" } }) }));
vi.mock("../components/ApiErrorNotice.js", () => ({
  ApiErrorNotice: ({ onRetry }: { onRetry?: () => void }) => <button type="button" onClick={onRetry}>Retry</button>,
}));
vi.mock("../connection.js", () => ({
  useConnection: () => ({ config: { projectId: "11111111-1111-4111-8111-111111111111" } }),
}));
vi.mock("../goals.js", () => ({
  useGoals: () => ({
    goals: mocks.goals,
    selectedGoalId: mocks.selectedGoalId,
    selectGoal: mocks.selectGoal,
    refresh: mocks.refresh,
    loadedFor: mocks.goalsLoadedFor,
    loading: mocks.goalsLoading,
    error: mocks.goalsError,
  }),
}));
vi.mock("../useGoalDetail.js", () => ({
  useGoalDetail: () => ({
    detail: mocks.hasDetail ? {
      goal: { goalId: "22222222-2222-4222-8222-222222222222", projectId: "11111111-1111-4111-8111-111111111111", state: "active", version: 1 },
      budget: { budgetCents: 1000, reservedCents: 250, costCents: 100 },
      certifications: [],
    } : undefined,
    loadedFor: mocks.detailLoadedFor,
    errorLoadedFor: mocks.detailLoadedFor,
    loading: false,
    error: mocks.hasDetail ? undefined : mocks.detailError,
    refresh: mocks.refresh,
  }),
}));
vi.mock("../useGoalWorkers.js", () => ({ useGoalWorkers: () => ({ workers: undefined, loading: false, error: undefined }) }));
vi.mock("../useGoalEvidenceBundle.js", () => ({ useGoalEvidenceBundle: () => ({ evidenceBundle: undefined, error: undefined }) }));
vi.mock("./panels/useGoalProjection.js", () => ({
  useGoalProjection: () => ({ projection: undefined, loading: false, error: undefined }),
}));
vi.stubGlobal("window", { maestro: { api: {} } });
vi.stubGlobal("React", React);
vi.mock("./panels/GoalDepartmentPanels.js", () => ({ GoalDepartmentPanels: () => null }));

function findGoalCard(node: ReactNode): ReactElement<{
  children?: ReactNode;
  className?: string;
  onClick?: () => void;
}> | undefined {
  if (node === null || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findGoalCard(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!("type" in node) || !("props" in node)) return undefined;
  const element = node as ReactElement<{
    children?: ReactNode;
    className?: string;
    onClick?: () => void;
  }>;
  if ((element.type === "div" || element.type === "button") && element.props.className?.startsWith("dept-card ")) return element;
  return findGoalCard(element.props.children);
}

function findRetryButton(node: ReactNode): ReactElement<{ type?: string; onClick?: () => void }> | undefined {
  if (node === null || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRetryButton(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!("type" in node) || !("props" in node)) return undefined;
  const element = node as ReactElement<{ children?: ReactNode; type?: string; onClick?: () => void }>;
  if (element.type === "button" && element.props.children === "Retry") return element;
  if (typeof element.type === "function") {
    const renderFunction = element.type as unknown as (props: unknown) => ReactNode;
    return findRetryButton(renderFunction(element.props));
  }
  return findRetryButton(element.props.children);
}

describe("Dashboard Goal-read recovery", () => {
  it("selects a Goal card through native button activation", () => {
    mocks.selectGoal.mockClear();
    const view = Dashboard({
      onNavigate: vi.fn(),
      eventState: { cursor: "0", events: [], stale: false, transport: "polling", error: undefined },
    });
    const goalCard = findGoalCard(view);
    expect(goalCard).toBeDefined();
    goalCard?.props.onClick?.();
    goalCard?.props.onClick?.();

    expect(mocks.selectGoal).toHaveBeenNthCalledWith(1, "22222222-2222-4222-8222-222222222222");
    expect(mocks.selectGoal).toHaveBeenNthCalledWith(2, "22222222-2222-4222-8222-222222222222");
  });

  it("renders semantic dashboard sections and a distinct emergency control", () => {
    mocks.hasDetail = true;
    const view = Dashboard({
      onNavigate: vi.fn(),
      eventState: { cursor: "0", events: [], stale: false, transport: "polling", error: undefined },
    });
    mocks.hasDetail = false;
    const root = view as ReactElement<{ children?: ReactNode; className?: string; role?: string }>;
    expect(root.type).toBe("main");
    expect(root.props.className).toBe("dash-main");

    const findButtons = (node: ReactNode): ReactElement<{ className?: string; type?: string }>[] => {
      if (node === null || typeof node !== "object") return [];
      if (Array.isArray(node)) return node.flatMap(findButtons);
      if (!("type" in node) || !("props" in node)) return [];
      const element = node as ReactElement<{ children?: ReactNode; className?: string; type?: string }>;
      return [
        ...(element.type === "button" ? [element] : []),
        ...findButtons(element.props.children),
      ];
    };
    const controls = findButtons(view).filter((button) => button.props.className?.includes("dash-control"));
    expect(controls).toHaveLength(4);
    expect(controls.every((button) => button.props.type === "button")).toBe(true);
    expect(controls.find((button) => button.props.className?.includes("dash-control-danger"))).toBeDefined();
  });

  it("does not render a prior Goal before the refreshed list commits", () => {
    mocks.goals = [{ goalId: "22222222-2222-4222-8222-222222222222", state: "active", version: 1 }];
    mocks.selectedGoalId = "22222222-2222-4222-8222-222222222222";
    mocks.goalsLoading = false;
    mocks.goalsError = undefined;
    mocks.goalsLoadedFor = { projectId: "11111111-1111-4111-8111-111111111111", refreshKey: "0" };
    const view = Dashboard({
      onNavigate: vi.fn(),
      eventState: { cursor: "1", events: [], stale: false, transport: "sse", error: undefined },
    });

    expect(findGoalCard(view)).toBeUndefined();
    mocks.goalsLoadedFor = { projectId: "11111111-1111-4111-8111-111111111111", refreshKey: "0" };
  });

  it("does not render stale Goal adjuncts after the list refreshes", () => {
    mocks.goals = [{ goalId: "22222222-2222-4222-8222-222222222222", state: "active", version: 1 }];
    mocks.selectedGoalId = "22222222-2222-4222-8222-222222222222";
    mocks.goalsLoading = false;
    mocks.goalsError = undefined;
    mocks.goalsLoadedFor = { projectId: "11111111-1111-4111-8111-111111111111", refreshKey: "1" };
    mocks.hasDetail = true;
    mocks.detailLoadedFor = { projectId: "11111111-1111-4111-8111-111111111111", goalId: "22222222-2222-4222-8222-222222222222", refreshKey: "0" };
    const view = Dashboard({
      onNavigate: vi.fn(),
      eventState: { cursor: "1", events: [], stale: false, transport: "sse", error: undefined },
    });

    expect(JSON.stringify(view)).not.toContain("Durable version 1");
    mocks.hasDetail = false;
    mocks.detailLoadedFor = { projectId: "11111111-1111-4111-8111-111111111111", goalId: "22222222-2222-4222-8222-222222222222", refreshKey: "0" };
  });

  it("does not render a stale detail error after the Goal scope changes", () => {
    mocks.goals = [{ goalId: "22222222-2222-4222-8222-222222222222", state: "active", version: 1 }];
    mocks.selectedGoalId = "22222222-2222-4222-8222-222222222222";
    mocks.goalsLoading = false;
    mocks.goalsError = undefined;
    mocks.goalsLoadedFor = { projectId: "11111111-1111-4111-8111-111111111111", refreshKey: "1" };
    mocks.hasDetail = false;
    mocks.detailError = "stale detail failure";
    mocks.detailLoadedFor = { projectId: "11111111-1111-4111-8111-111111111111", goalId: "22222222-2222-4222-8222-222222222222", refreshKey: "0" };
    const view = Dashboard({
      onNavigate: vi.fn(),
      eventState: { cursor: "1", events: [], stale: false, transport: "sse", error: undefined },
    });

    expect(JSON.stringify(view)).not.toContain("stale detail failure");
    mocks.detailError = "gateway unavailable";
  });

  it("does not render a prior Goal while the durable list refresh is unresolved", () => {
    mocks.goals = [{ goalId: "22222222-2222-4222-8222-222222222222", state: "active", version: 1 }];
    mocks.selectedGoalId = "22222222-2222-4222-8222-222222222222";
    mocks.goalsLoading = true;
    mocks.goalsError = undefined;
    const view = Dashboard({
      onNavigate: vi.fn(),
      eventState: { cursor: "1", events: [], stale: false, transport: "sse", error: undefined },
    });

    expect(findGoalCard(view)).toBeUndefined();
    mocks.goalsLoading = false;
  });

  it("offers a Retry button for a selected Goal read error and refreshes on click", () => {
    mocks.goalsLoadedFor = { projectId: "11111111-1111-4111-8111-111111111111", refreshKey: "0" };
    mocks.detailLoadedFor = { projectId: "11111111-1111-4111-8111-111111111111", goalId: "22222222-2222-4222-8222-222222222222", refreshKey: "0" };
    mocks.detailError = "gateway unavailable";
    mocks.goalsError = undefined;
    mocks.refresh.mockClear();
    const view = Dashboard({
      onNavigate: vi.fn(),
      eventState: { cursor: "0", events: [], stale: false, transport: "polling", error: undefined },
    });
    const retry = findRetryButton(view);

    expect(retry).toBeDefined();
    expect(retry?.props.type).toBe("button");
    retry?.props.onClick?.();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps Goal-list recovery visible before a Goal is selected", () => {
    mocks.refresh.mockClear();
    mocks.hasDetail = false;
    mocks.detailError = undefined;
    mocks.goalsError = "Goal list unavailable";
    mocks.goals = [];
    mocks.selectedGoalId = undefined;
    const view = Dashboard({
      onNavigate: vi.fn(),
      eventState: { cursor: "0", events: [], stale: false, transport: "polling", error: undefined },
    });
    const retry = findRetryButton(view);
    expect(retry).toBeDefined();
    retry?.props.onClick?.();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    mocks.goalsError = undefined;
    mocks.detailError = "gateway unavailable";
    mocks.goals = [{ goalId: "22222222-2222-4222-8222-222222222222", state: "active", version: 1 }];
    mocks.selectedGoalId = "22222222-2222-4222-8222-222222222222";
  });
});
