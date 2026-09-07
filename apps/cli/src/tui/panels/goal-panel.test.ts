import { describe, expect, it } from "vitest";
import { renderGoalPanel } from "./goal-panel.js";
import { renderOrganizationPanel } from "./organization-panel.js";
import { renderEvidencePanel } from "./evidence-panel.js";
import { renderIncidentPanel } from "./incident-panel.js";
import { renderPortfolioPanel } from "./portfolio-panel.js";

describe("TUI read panels", () => {
  it("renders linear Goal details and truthful empty/error states", () => {
    expect(renderGoalPanel({ kind: "value", value: [{ goalId: "goal-1", projectId: "project-1", state: "active", version: 3 }] }, 80)).toEqual(["Goals", "• goal-1 · active · v3"]);
    expect(renderGoalPanel({ kind: "empty" }, 80)).toEqual(["Goals", "No goals found."]);
    expect(renderGoalPanel({ kind: "error", message: "offline" }, 80)).toEqual(["Goals", "Unable to read goals: offline"]);
  });

  it("keeps organization, evidence, incident, and portfolio panels linear", () => {
    expect(renderOrganizationPanel({ kind: "empty" }, 80)).toEqual(["Organization", "No organization data."]);
    expect(renderEvidencePanel({ kind: "value", value: [{ id: "e1", kind: "test" }] }, 80)).toEqual(["Evidence", "• e1 · test"]);
    expect(renderIncidentPanel({ kind: "error", message: "unavailable" }, 80)).toEqual(["Incidents", "Unable to read incidents: unavailable"]);
    expect(renderPortfolioPanel({ kind: "value", value: { activeGoals: 2, capacity: 4 } }, 80)).toEqual(["Portfolio", "• active goals: 2/4"]);
  });
});
