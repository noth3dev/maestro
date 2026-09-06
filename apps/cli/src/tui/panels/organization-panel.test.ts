import { describe, expect, it } from "vitest";
import { renderOrganizationPanel } from "./organization-panel.js";

describe("organization panel", () => {
  it("renders loading and departments", () => {
    expect(renderOrganizationPanel({ kind: "loading" }, 80)).toEqual(["Organization", "Loading organization…"]);
    expect(renderOrganizationPanel({ kind: "value", value: { departments: ["engineering"] } }, 80)).toEqual(["Organization", "• engineering"]);
  });
});
