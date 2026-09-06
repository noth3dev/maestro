import { describe, expect, it } from "vitest";
import { renderIncidentPanel } from "./incident-panel.js";

describe("incident panel", () => {
  it("renders errors without hiding the unavailable state", () => {
    expect(renderIncidentPanel({ kind: "error", message: "offline" }, 80)).toEqual(["Incidents", "Unable to read incidents: offline"]);
  });
});
