import React, { type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard.js";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

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
    selectGoal: vi.fn(),
  }),
}));
vi.mock("../useGoalDetail.js", () => ({
  useGoalDetail: () => ({ detail: undefined, loading: false, error: "gateway unavailable", refresh: mocks.refresh }),
}));
vi.mock("../useGoalWorkers.js", () => ({ useGoalWorkers: () => ({ workers: undefined, loading: false, error: undefined }) }));
vi.mock("../useGoalEvidenceBundle.js", () => ({ useGoalEvidenceBundle: () => ({ evidenceBundle: undefined, error: undefined }) }));
vi.mock("./panels/useGoalProjection.js", () => ({
  useGoalProjection: () => ({ projection: undefined, loading: false, error: undefined }),
}));
vi.stubGlobal("window", { maestro: { api: {} } });
vi.stubGlobal("React", React);
vi.mock("./panels/GoalDepartmentPanels.js", () => ({ GoalDepartmentPanels: () => null }));

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
