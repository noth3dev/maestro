import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const setup = readFileSync(new URL("./views/Setup.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles/components.css", import.meta.url), "utf8");

describe("Carnegie setup frame", () => {
  it("uses the expanded connection card instead of inline sizing", () => {
    expect(setup).toContain('className="home-composer setup-card"');
    expect(setup).not.toContain("maxWidth: 380");
  });

  it("keeps setup controls readable at the enlarged scale", () => {
    expect(styles).toContain(".setup-card");
    expect(styles).toContain("min-height:48px");
    expect(styles).toContain("font-size:14px");
  });
});
