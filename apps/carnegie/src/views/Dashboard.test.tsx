import React, { type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard.js";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), selectGoal: vi.fn(), hasDetail: false }));

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
vi.mock("../connection.js", () => ({
  useConnection: () => ({ config: { projectId: "11111111-1111-4111-8111-111111111111" } }),
}));
vi.mock("../goals.js", () => ({
  useGoals: () => ({
    goals: [{ goalId: "22222222-2222-4222-8222-222222222222", state: "active", version: 1 }],
    selectedGoalId: "22222222-2222-4222-8222-222222222222",
    selectGoal: mocks.selectGoal,
  }),
}));
vi.mock("../useGoalDetail.js", () => ({
  useGoalDetail: () => ({
    detail: mocks.hasDetail ? {
      goal: { goalId: "22222222-2222-4222-8222-222222222222", state: "active", version: 1 },
      budget: { budgetCents: 1000, reservedCents: 250, costCents: 100 },
      certifications: [],
    } : undefined,
    loading: false,
    error: mocks.hasDetail ? undefined : "gateway unavailable",
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
    mocks.hasDetail = false;
  });

  it("offers a Retry button for a selected Goal read error and refreshes on click", () => {
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
});
