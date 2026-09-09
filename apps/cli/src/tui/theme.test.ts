import { afterEach, describe, expect, it } from "vitest";
import { getModeAccentProgress, paintTranscript, setModeAccentProgress, tuiTheme } from "./theme.js";

const originalNoColor = process.env.NO_COLOR;
const originalColorTerm = process.env.COLORTERM;

afterEach(() => {
  setModeAccentProgress(0);
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
  if (originalColorTerm === undefined) delete process.env.COLORTERM;
  else process.env.COLORTERM = originalColorTerm;
});

describe("TUI theme", () => {
  it("animates the Warm Earth accent into the Flashmob execution-profile accent", () => {
    delete process.env.NO_COLOR;
    process.env.COLORTERM = "truecolor";
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

  it("does not infer success from prose such as disconnected", () => {
    delete process.env.NO_COLOR;
    process.env.COLORTERM = "truecolor";
    const output = paintTranscript({ kind: "text", text: "Activity stream disconnected" }, 80);

    expect(output).toBe("  Activity stream disconnected");
    expect(output).not.toContain("38;2;122;186;122");
  });

  it("switches on semantic kind rather than transcript text", () => {
    delete process.env.NO_COLOR;
    process.env.COLORTERM = "truecolor";
    const first = paintTranscript({ kind: "error", text: "first message" }, 80);
    const changed = paintTranscript({ kind: "error", text: "changed message" }, 80);

    // eslint-disable-next-line no-control-regex
    expect(first).toMatch(/^\u001b\[38;2;200;106;88m/);
    // eslint-disable-next-line no-control-regex
    expect(changed).toMatch(/^\u001b\[38;2;200;106;88m/);
  });

  it("emits no ANSI colour escapes when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    process.env.COLORTERM = "truecolor";

    expect(paintTranscript({ kind: "error", text: "failure" }, 80)).toBe("  failure");
    expect(tuiTheme.primary("accent")).toBe("accent");
  });

  it("uses ANSI-16 when truecolor is not advertised", () => {
    delete process.env.NO_COLOR;
    process.env.COLORTERM = "256color";

    const output = paintTranscript({ kind: "success", text: "connected" }, 80);

    expect(output).toContain("\u001b[32m");
    expect(output).not.toContain("38;2;");
  });

  it("leaves body text in the terminal default foreground", () => {
    delete process.env.NO_COLOR;
    process.env.COLORTERM = "truecolor";

    expect(paintTranscript({ kind: "text", text: "body text" }, 80)).toBe("  body text");
  });
});
