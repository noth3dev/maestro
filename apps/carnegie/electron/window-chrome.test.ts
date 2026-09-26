import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("./preload.cts", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles/components.css", import.meta.url), "utf8");
const compactStyles = styles.replace(/\s+/g, "");

describe("Carnegie custom window chrome", () => {
  it("removes the native frame and exposes safe window controls", () => {
    expect(main).toContain("frame: false");
    expect(main).toContain("maestro:window:minimize");
    expect(main).toContain("maestro:window:toggle-maximize");
    expect(main).toContain("maestro:window:close");
    expect(main).toContain('window.once("show"');
    expect(main).toContain("window.show();");
    expect(preload).toContain("windowControls");
  });

  it("renders a draggable branded title bar", () => {
    expect(renderer).toContain("WindowChrome");
    expect(styles).toContain(".window-titlebar");
    expect(compactStyles).toContain("-webkit-app-region:drag");
    expect(compactStyles).toContain("-webkit-app-region:no-drag");
    expect(compactStyles).toContain("cursor:default");
  });
});
