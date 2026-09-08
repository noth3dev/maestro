import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(new URL("./index.html", import.meta.url), "utf8");

describe("Carnegie desktop branding", () => {
  it("uses Carnegie as the desktop document title", () => {
    expect(indexHtml).toContain("<title>Carnegie</title>");
  });
});
