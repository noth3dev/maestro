import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const home = read("./views/Home.tsx");
const sidebar = read("./components/Sidebar.tsx");
const channel = read("./views/Channel.tsx");
const approvals = read("./views/Approvals.tsx");
const toggle = read("./components/ToggleSwitch.tsx");
const styles = read("./styles/components.css");
const windowChrome = read("./components/WindowChrome.tsx");
const main = read("../electron/main.ts");

describe("Task 13 Carnegie accessibility and scale contract", () => {
  it("uses semantic navigation and controls for the sidebar and Home shortcuts", () => {
    expect(sidebar).toContain("<nav");
    expect(home).not.toContain('<div className="home-card" onClick=');
    expect(home).toContain('<button type="button" className="home-card"');
  });

  it("exposes a keyboard-operable switch with an accessible name", () => {
    expect(toggle).toContain("<button");
    expect(toggle).toContain('role="switch"');
    expect(toggle).toContain("aria-checked");
    expect(toggle).toContain("aria-label");
  });

  it("announces channel, approval, and conversation state changes", () => {
    expect(channel).toContain('role="status"');
    expect(channel).toContain('role="alert"');
    expect(approvals).toContain('role="status"');
    expect(approvals).toContain('role="alert"');
    expect(home).toContain('aria-live="polite"');
  });

  it("keeps semantic focus indicators and narrow layouts usable", () => {
    expect(styles).toContain(":focus-visible");
    expect(styles).toMatch(/@media \(max-width: 960px\)/);
    expect(styles).toMatch(/@media \(max-width: 640px\)/);
    expect(styles).toContain("overflow-wrap:anywhere");
  });

  it("keeps native window controls labelled and the agreed page zoom wired", () => {
    expect(windowChrome).toContain('aria-label="Minimize window"');
    expect(windowChrome).toContain('aria-label={maximized ? "Restore window" : "Maximize window"}');
    expect(windowChrome).toContain('aria-label="Close window"');
    expect(main).toContain("setZoomFactor(DEFAULT_ZOOM_FACTOR)");
    expect(main).toContain("before-input-event");
  });
});
