import { chromium, expect, test } from "@playwright/test";

const cdpEndpoint = process.env.MAESTRO_CARNEGIE_CDP_URL;
const liveAcceptance = process.env.MAESTRO_CARNEGIE_LIVE_ACCEPTANCE === "1";

test("captures the bounded live Carnegie window at supported scale", async () => {
  test.skip(!liveAcceptance || cdpEndpoint === undefined, "Set MAESTRO_CARNEGIE_LIVE_ACCEPTANCE=1 and MAESTRO_CARNEGIE_CDP_URL for live evidence.");
  const browser = await chromium.connectOverCDP(cdpEndpoint as string);
  try {
    const page = browser.contexts()[0]?.pages().find((candidate) => !candidate.isClosed());
    expect(page).toBeDefined();
    if (page === undefined) return;
    await page.waitForLoadState("domcontentloaded");
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }));
    expect(viewport.width).toBeGreaterThan(0);
    expect(viewport.height).toBeGreaterThan(0);
    expect(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "/tmp/carnegie-task13-live.png", fullPage: false });
  } finally {
    await browser.close();
  }
});
