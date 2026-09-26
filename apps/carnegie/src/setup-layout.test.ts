import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const setup = readFileSync(new URL("./views/Setup.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles/components.css", import.meta.url), "utf8");
const compactStyles = styles.replace(/\s+/g, "");
const main = readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");

describe("Carnegie setup frame", () => {
  it("uses the expanded connection card instead of inline sizing", () => {
    expect(setup).toContain('className="home-composer setup-card"');
    expect(setup).toContain('details className="setup-manual"');
    expect(setup).toContain('form className="setup-manual-form"');
    expect(setup).not.toContain("maxWidth: 380");
  });

  it("keeps setup controls readable at the enlarged scale", () => {
    expect(styles).toContain(".setup-card");
    expect(compactStyles).toContain("min-height:48px");
    expect(compactStyles).toContain("font-size:14px");
  });

  it("keeps the frameless shell usable at narrow widths without replacing Electron zoom", () => {
    expect(compactStyles).toContain(".channel-wrap{flex-direction:column;}");
    expect(compactStyles).toContain(".home-cards{grid-template-columns:1fr;}");
    expect(compactStyles).toContain(".roster{width:100%;");
    expect(main).toContain("setZoomFactor(DEFAULT_ZOOM_FACTOR)");
    expect(main).toContain("zoomFactorAfterInput");
  });
});
