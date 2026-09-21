import React, { type ReactNode, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Planning } from "./Planning.js";

const api = vi.hoisted(() => ({
  selectOvertureRoles: vi.fn().mockResolvedValue({ contractId: "33333333-3333-4333-8333-333333333333", selectionId: "selection-1", roles: [] }),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useEffect: () => undefined, useState: (initial: unknown) => [initial, vi.fn()] };
});
vi.mock("../connection.js", () => ({ useConnection: () => ({ config: { projectId: "11111111-1111-4111-8111-111111111111" } }) }));
vi.mock("../goals.js", () => ({ useGoals: () => ({ goals: [{ goalId: "22222222-2222-4222-8222-222222222222", contractId: "33333333-3333-4333-8333-333333333333" }], selectedGoalId: "22222222-2222-4222-8222-222222222222" }) }));
vi.mock("../components/EmptyState.js", () => ({ EmptyState: () => null }));
vi.mock("../components/ApiErrorNotice.js", () => ({ ApiErrorNotice: () => null }));
vi.stubGlobal("window", { maestro: { api } });
vi.stubGlobal("React", React);

function findButton(node: ReactNode, label: string): ReactElement<{ onClick?: () => void }> | undefined {
  if (node === null || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!("type" in node) || !("props" in node)) return undefined;
  const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  if (element.type === "button" && element.props.children === label) return element;
  return findButton(element.props.children, label);
}

describe("Planning overture scope", () => {
  it("passes the connected project id to the server-backed role selection", () => {
    api.selectOvertureRoles.mockClear();
    const view = Planning({ onNavigate: vi.fn() });
    findButton(view, "Select Overture roles")?.props.onClick?.();
    expect(api.selectOvertureRoles).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
      { projectId: "11111111-1111-4111-8111-111111111111", outsideEvidenceRequested: false, previewNeeded: false },
      expect.any(String),
    );
  });
});
