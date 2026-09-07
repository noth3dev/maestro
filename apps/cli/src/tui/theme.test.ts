import { afterEach, describe, expect, it } from "vitest";
import { getModeAccentProgress, setModeAccentProgress, tuiTheme } from "./theme.js";

afterEach(() => setModeAccentProgress(0));

describe("TUI theme", () => {
  it("animates the Warm Earth accent into the Flashmob execution-profile accent", () => {
    setModeAccentProgress(0);
    const warm = tuiTheme.primary("x");
    setModeAccentProgress(0.5);
    const middle = tuiTheme.primary("x");
    setModeAccentProgress(1);
    const blue = tuiTheme.primary("x");

    expect(warm).toContain("38;2;201;120;85");
    expect(middle).not.toBe(warm);
    expect(blue).toContain("38;2;106;154;186");
    expect(getModeAccentProgress()).toBe(1);
  });

  it("leaves the terminal background untouched", () => {
    expect(tuiTheme.page("content")).toBe("content");
    expect(tuiTheme.inputSurface("content")).toBe("content");
  });
});
