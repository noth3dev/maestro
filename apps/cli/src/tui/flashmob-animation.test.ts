import { describe, expect, it } from "vitest";
import { animateAccentProgress } from "./flashmob-animation.js";

describe("flashmob accent animation", () => {
  it("steps through the accent transition and finishes at the target", async () => {
    const progress: number[] = [];
    let renders = 0;

    await expect(
      animateAccentProgress({
        from: 0,
        to: 1,
        isCurrent: () => true,
        setProgress: (value) => progress.push(value),
        render: () => {
          renders += 1;
        },
        wait: async () => undefined,
      }),
    ).resolves.toBe(true);

    expect(progress).toHaveLength(13);
    expect(progress.at(0)).toBeCloseTo(1 / 12);
    expect(progress.at(-1)).toBe(1);
    expect(renders).toBe(13);
  });

  it("stops before the next step when the animation is superseded", async () => {
    const progress: number[] = [];
    let current = true;

    await expect(
      animateAccentProgress({
        from: 0,
        to: 1,
        isCurrent: () => current,
        setProgress: (value) => {
          progress.push(value);
          current = false;
        },
        render: () => undefined,
        wait: async () => undefined,
      }),
    ).resolves.toBe(false);

    expect(progress).toEqual([1 / 12]);
  });
});
