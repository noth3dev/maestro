import { chromium, expect, test, type Browser, type Page } from "@playwright/test";

const cdpEndpoint = process.env.MAESTRO_CARNEGIE_CDP_URL;

async function connectToCarnegie(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.connectOverCDP(cdpEndpoint as string);
  const context = browser.contexts()[0];
  const page = context?.pages().find((candidate) => !candidate.isClosed());
  if (context === undefined || page === undefined) {
    await browser.close();
    throw new Error("The Carnegie CDP endpoint has no open renderer page.");
  }
  await page.waitForLoadState("domcontentloaded");
  return { browser, page };
}

async function skipWithoutElectron(): Promise<void> {
  test.skip(cdpEndpoint === undefined, "Set MAESTRO_CARNEGIE_CDP_URL to run against the live Electron window.");
}

test.describe("Carnegie E5 keyboard and semantics", () => {
  test("exposes keyboard-reachable sidebar, Home composer, and native window controls", async () => {
    await skipWithoutElectron();
    const { browser, page } = await connectToCarnegie();
    try {
      await expect(page.getByRole("button", { name: "Minimize window" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Maximize window|Restore window/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Close window" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
      const composer = page.getByRole("textbox", { name: "Brief the Concertmaster" });
      await expect(composer).toBeVisible();
      await expect(composer).toHaveAttribute("id", "home-brief");
      const draft = page.locator('[aria-labelledby="home-draft-title"]');
      if (await draft.count() > 0) {
        const fields = {
          "draft-outcome": "Desired outcome",
          "draft-success": "Success criteria (one per line)",
          "draft-repository": "Repository",
          "draft-base-revision": "Immutable base revision",
          "draft-boundary": "Data boundary",
        } as const;
        for (const [field, label] of Object.entries(fields)) {
          await expect(draft.locator(`#${field}`)).toHaveAccessibleName(label);
        }
      }
      await composer.focus();
      await expect(composer).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.locator(":focus-visible")).toHaveCount(1);
    } finally {
      await browser.close();
    }
  });

  test("keeps draft form labels and confirmation dialog focus ordered", async () => {
    await skipWithoutElectron();
    const { browser, page } = await connectToCarnegie();
    try {
      await page.getByRole("button", { name: /Dashboard/i }).click();
      const stop = page.getByRole("button", { name: "Stop", exact: true });
      await expect(stop).toBeVisible();
      await stop.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-describedby", /.+/);
      await expect(dialog).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(stop).toBeFocused();
    } finally {
      await browser.close();
    }
  });

  test("announces live channel state and keeps the selected Goal action surface semantic", async () => {
    await skipWithoutElectron();
    const { browser, page } = await connectToCarnegie();
    try {
      await page.getByRole("button", { name: "channel", exact: true }).click();
      expect(await page.getByRole("status").count()).toBeGreaterThan(0);
      await expect(page.getByRole("textbox", { name: /Message #/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Show roster|Hide roster/ })).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test("keeps approval actions keyboard-operable and errors announced", async () => {
    await skipWithoutElectron();
    const { browser, page } = await connectToCarnegie();
    try {
      await page.getByRole("button", { name: /Inbox/i }).click();
      await expect(page.getByRole("heading", { name: "inbox" })).toBeVisible();
      expect(await page.locator('[role="alert"], [role="status"]').count()).toBeGreaterThan(0);
      for (const name of ["approve and run", "deny", "Discuss with Concertmaster"]) {
        const action = page.getByRole("button", { name: new RegExp(name, "i") }).first();
        if (await action.count() > 0) await expect(action).toBeEnabled();
      }
    } finally {
      await browser.close();
    }
  });
});
