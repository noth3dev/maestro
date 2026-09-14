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

  test("linear controls mirror graph actions and contain node details focus", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}${smokeRoute}`);
    const linear = page.locator('[aria-label="Linear alternative"]');
    const search = linear.locator('input[aria-label="Search nodes in linear alternative"]');
    await search.fill("Goal");
    await search.press("Enter");
    await expect(linear.locator('[data-radial-node-id="22222222-2222-4222-8222-222222222222"]').first()).toHaveAttribute("aria-pressed", "true");

    for (const operation of ["zoom-in", "zoom-out", "fit", "pan-up", "pan-down", "pan-left", "pan-right", "back"]) {
      await linear.locator(`[data-linear-operation="${operation}"]`).click();
    }
    const node = linear.locator('[data-linear-operation="select-node"]').filter({ hasText: "Goal" }).first();
    await node.click();
    await expect(node).toHaveAttribute("aria-pressed", "true");

    const details = linear.locator('[aria-label="Node details: Goal"]');
    await details.click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("button")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.locator("button")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.locator("button")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(details).toBeFocused();
  });

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
