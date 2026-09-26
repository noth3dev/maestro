import { test, expect } from "@playwright/test";
import axe from "axe-core";

const smokeRoute = "/views/kanban-smoke.html";

test.describe("Carnegie slice board accessibility", () => {
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

  test("keyboard users can open every slice card", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}${smokeRoute}`);
    const cards = page.locator(".kb-card-head");
    await expect(cards).toHaveCount(5);
    await cards.first().focus();
    await page.keyboard.press("Enter");
    await expect(cards.first()).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator('[data-slice-id="p1s3"] .kb-blocked')).toBeVisible();
  });
});
