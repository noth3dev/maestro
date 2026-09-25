import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";

const fixtureRoute = "/views/router-catalog-layout-fixture.html";

async function openFixture(page: Page, baseURL: string | undefined): Promise<void> {
  if (baseURL === undefined) throw new Error("Playwright baseURL is not configured");
  await page.goto(`${baseURL}${fixtureRoute}`);
  await expect(page.getByText("Ensemble Router", { exact: true })).toBeVisible();
}

test.describe("Router Catalog layout and scroll accessibility", () => {
  test("uses the bounded width at the recorded desktop viewport and leaves Providers unchanged", async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width: 2880, height: 1716 });
    await openFixture(page, baseURL);
    const metrics = await page.evaluate(() => {
      const panel = document.querySelector(".router-catalog-panel");
      const providers = document.querySelector('[data-testid="providers-panel"]');
      if (panel === null || providers === null) throw new Error("Fixture layout is incomplete");
      const wrapper = panel.querySelector(".router-table-wrap");
      if (wrapper === null) throw new Error("Fixture layout is incomplete");
      const table = wrapper.querySelector("table");
      if (table === null) throw new Error("Fixture layout is incomplete");
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
        panelWidth: panel.getBoundingClientRect().width,
        providersWidth: providers.getBoundingClientRect().width,
        wrapperClientWidth: wrapper.clientWidth,
        wrapperScrollWidth: wrapper.scrollWidth,
        tableWidth: table.getBoundingClientRect().width,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        columnHeaders: panel.querySelectorAll(".router-catalog-table th").length,
      };
    });
    await page.screenshot({ path: testInfo.outputPath("router-catalog-desktop.png") });
    expect(metrics.viewport).toEqual({ width: 2880, height: 1716, dpr: 1 });
    expect(metrics.panelWidth).toBe(1180);
    expect(metrics.providersWidth).toBe(780);
    expect(metrics.wrapperClientWidth).toBeGreaterThanOrEqual(820);
    expect(metrics.wrapperScrollWidth).toBeLessThanOrEqual(metrics.wrapperClientWidth);
    expect(metrics.tableWidth).toBeGreaterThanOrEqual(820);
    expect(metrics.columnHeaders).toBe(18);
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport.width);
    expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewport.width);
  });

  test("keeps overflow inside table wrappers at the supported-size and simulated narrow widths", async ({ page, baseURL }) => {
    for (const width of [960, 720, 640, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await openFixture(page, baseURL);
      const metrics = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        wrappers: [...document.querySelectorAll<HTMLElement>(".router-table-wrap")].map((wrapper) => ({
          clientWidth: wrapper.clientWidth,
          scrollWidth: wrapper.scrollWidth,
        })),
      }));
      expect(metrics.viewportWidth).toBe(width);
      expect(metrics.documentWidth).toBeLessThanOrEqual(width);
      expect(metrics.bodyWidth).toBeLessThanOrEqual(width);
      expect(metrics.wrappers).toHaveLength(3);
      expect(metrics.wrappers.every((wrapper) => wrapper.scrollWidth > wrapper.clientWidth)).toBe(true);
    }

    await page.setViewportSize({ width: 640, height: 900 });
    await openFixture(page, baseURL);
    const firstScrollport = page.getByRole("region", { name: "anthropic Router Catalog model table", exact: true });
    await page.getByLabel("use").focus();
    await page.keyboard.press("Tab");
    await expect(firstScrollport).toBeFocused();
    const focusStyle = await firstScrollport.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle, outlineColor: style.outlineColor };
    });
    expect(focusStyle.outlineWidth).toBe("2px");
    expect(focusStyle.outlineStyle).toBe("solid");
    expect(focusStyle.outlineColor).not.toBe("rgba(0, 0, 0, 0)");
    const before = await firstScrollport.evaluate((element) => element.scrollLeft);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => firstScrollport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before);
  });

  test("preserves the two-column and one-column filter breakpoints", async ({ page, baseURL }) => {
    for (const [width, columns] of [
      [641, 2],
      [640, 1],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await openFixture(page, baseURL);
      const count = await page
        .locator(".router-catalog-filters")
        .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
      expect(count).toBe(columns);
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} theme has no WCAG 2 A/AA axe violations in Router Catalog`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 960, height: 900 });
      await openFixture(page, baseURL);
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => {
        const panel = document.querySelector(".router-catalog-panel");
        if (panel === null) throw new Error("Router Catalog fixture panel is missing");
        const axeRun = (window as unknown as Window & { axe: typeof axe }).axe.run;
        return (
          await axeRun(panel, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
            resultTypes: ["violations"],
          })
        ).violations;
      });
      const violationSummary = violations.map((violation) => ({
        id: violation.id,
        targets: violation.nodes.map((node) => node.target),
      }));
      expect(violationSummary, JSON.stringify(violationSummary, null, 2)).toEqual([]);
    });
  }
});
