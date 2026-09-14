import { test, expect } from "@playwright/test";
import axe from "axe-core";

const smokeRoute = "/views/panels/radial/electron-renderer-smoke.html";

test.describe("Carnegie primary route accessibility", () => {
  for (const theme of ["light", "dark"]) {
    test(`${theme} theme has no axe violations`, async ({ page, baseURL }) => {
      await page.goto(`${baseURL}${smokeRoute}`);
      await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
      await page.addScriptTag({ content: axe.source });
      const result = await page.evaluate(async () => {
        const axeRun = (window as unknown as Window & { axe: typeof axe }).axe.run;
        return axeRun(document, { resultTypes: ["violations"] });
      });
      expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
    });
  }

  test("keyboard users can reach every linear operation and node", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}${smokeRoute}`);
    const controls = page.locator('[aria-label="Linear alternative"] button, [aria-label="Linear alternative"] input');
    const count = await controls.count();
    expect(count).toBeGreaterThan(8);
    await controls.first().focus();
    for (let index = 0; index < count; index += 1) {
      await expect(controls.nth(index)).toBeFocused();
      await page.keyboard.press("Tab");
    }
  });
});
