import { describe, expect, it } from "vitest";
import { PERSONA_AXES, SANE_PERSONA_BASELINE, parsePersonaProfile } from "./persona.js";

describe("persona profiles", () => {
  it("accepts Sane's fixed, exactly ten-axis baseline", () => {
    expect(PERSONA_AXES).toHaveLength(10);
    expect(parsePersonaProfile(SANE_PERSONA_BASELINE)).toEqual(SANE_PERSONA_BASELINE);
  });

  it("rejects a missing or extra axis", () => {
    const { sociability: _sociability, ...missing } = SANE_PERSONA_BASELINE;
    expect(() => parsePersonaProfile(missing)).toThrow();
    expect(() => parsePersonaProfile({ ...SANE_PERSONA_BASELINE, curiosity: 0.5 })).toThrow();
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])("rejects non-normalized axis %s", (value) => {
    expect(() => parsePersonaProfile({ ...SANE_PERSONA_BASELINE, caution: value })).toThrow();
  });
});
