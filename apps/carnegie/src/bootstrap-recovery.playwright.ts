import { expect, test } from "@playwright/test";
import axe from "axe-core";

declare global {
  interface Window {
    __bootstrapRetryCount: number;
    __manualConnectCount: number;
    __publishBootstrapStatus: (status: unknown) => void;
    __completeBootstrapRetry: ((outcome: "failure" | "success") => void) | undefined;
    __delayConnectionReads: boolean;
    __releaseConnectionReads: (() => void) | undefined;
  }
}

function rgbChannels(color: string): [number, number, number] {
  const channels = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (channels === undefined || channels.length !== 3) throw new Error(`Expected an RGB color, received ${color}`);
  return channels as [number, number, number];
}

function luminance(color: string): number {
  const channels = rgbChannels(color).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (lighter! + 0.05) / (darker! + 0.05);
}

async function openFixture(page: import("@playwright/test").Page, baseURL: string | undefined, query = ""): Promise<void> {
  if (baseURL === undefined) throw new Error("Playwright baseURL is not configured");
  await page.goto(`${baseURL}/bootstrap-recovery-fixture.html${query}`);
}

async function expectAxeClean(page: import("@playwright/test").Page): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const result = await page.evaluate(async () => {
    const axeRun = (window as unknown as Window & { axe: typeof axe }).axe.run;
    return axeRun(document, { resultTypes: ["violations"] });
  });
  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
}

test.describe("local bootstrap recovery renderer fixture", () => {
  test.describe.configure({ timeout: 10_000 });

  test("shows the fixture failure reason and a clearly labeled manual fallback", async ({ page, baseURL }) => {
    await openFixture(page, baseURL);

    await expect(page.getByRole("heading", { name: "Set up Maestro" })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("Docker is required for local automatic setup but is not available");
    await expect(
      page.getByText(
        "Start Docker, then retry local setup. To use a database URL instead, set MAESTRO_LOCAL_DATABASE_URL in the environment used to launch Carnegie and restart Carnegie.",
      ),
    ).toBeVisible();
    const manualConnection = page.locator("details.setup-manual");
    await expect(manualConnection).toBeVisible();
    await expect(manualConnection).not.toHaveAttribute("open", "");
    await expect(page.getByLabel("Control plane URL")).toBeHidden();
    await expect(page.getByLabel("Operator token")).toBeHidden();
    await expect(page.getByLabel("Project ID")).toBeHidden();
    await expect(page.getByRole("button", { name: "Retry local setup", exact: true })).toBeVisible();
    await manualConnection.locator("summary").click();
    await expect(page.getByLabel("Control plane URL")).toBeVisible();
    await expect(page.getByLabel("Operator token")).toBeVisible();
    await expect(page.getByLabel("Project ID")).toBeVisible();
  });

  for (const { locale, query, guidance } of [
    {
      locale: "English",
      query: "?reason=db-engine",
      guidance:
        "Set MAESTRO_LOCAL_DB_ENGINE to embedded or docker, or remove it to use the embedded default. Update the environment used to launch Carnegie, then restart Carnegie before retrying local setup.",
    },
    {
      locale: "Korean",
      query: "?reason=db-engine&locale=ko",
      guidance:
        "MAESTRO_LOCAL_DB_ENGINE을 embedded 또는 docker로 설정하거나 기본값인 embedded를 사용하려면 해당 변수를 제거하세요. Carnegie를 시작할 때 사용하는 환경을 수정한 뒤 Carnegie를 다시 시작하고 로컬 설정을 재시도하세요.",
    },
  ]) {
    test(`${locale} recovery guidance explains how to fix an invalid local database engine`, async ({ page, baseURL }) => {
      await openFixture(page, baseURL, query);
      await expect(page.getByRole("alert")).toContainText("MAESTRO_LOCAL_DB_ENGINE must be embedded or docker");
      await expect(page.getByText(guidance, { exact: true })).toBeVisible();
      await expect(page.getByText(/Start Docker/)).toHaveCount(0);
    });
  }

  test("explains how to correct an invalid embedded database port", async ({ page, baseURL }) => {
    await openFixture(page, baseURL, "?reason=db-port");
    await expect(page.getByRole("alert")).toContainText("MAESTRO_EMBEDDED_DATABASE_PORT must be an integer from 1 to 65535");
    await expect(
      page.getByText(
        "Set MAESTRO_EMBEDDED_DATABASE_PORT to an integer from 1 to 65535, or remove it to use the default. Update the environment used to launch Carnegie, then restart Carnegie before retrying local setup.",
      ),
    ).toBeVisible();
  });

  test("shows Docker diagnostics without mislabeling a container error as a Docker-daemon failure", async ({ page, baseURL }) => {
    await openFixture(page, baseURL, "?reason=docker-container");
    await expect(page.getByRole("alert")).toContainText("docker logs maestro-local-postgres");
    await expect(page.getByText("Run the Docker diagnostic command shown in the reason above, then retry local setup.")).toBeVisible();
    await expect(page.getByText(/Start Docker/)).toHaveCount(0);
  });

  test("gives a useful generic next step for other startup errors and keeps manual connection available", async ({ page, baseURL }) => {
    await openFixture(page, baseURL, "?reason=unknown");
    await expect(page.getByRole("alert")).toContainText("Model gateway is running but not ready");
    await expect(
      page.getByText(
        "Fix the issue described above. If it names a MAESTRO_* setting, update the environment used to launch Carnegie and restart Carnegie before retrying. If a Control Plane is already running on this computer, use Manual connection below.",
      ),
    ).toBeVisible();
    await expect(page.locator("details.setup-manual summary")).toHaveText("Manual connection");
  });

  test("retries through the fixture bridge and preserves focus and manual draft on failure", async ({ page, baseURL }) => {
    await openFixture(page, baseURL);
    const retry = page.getByRole("button", { name: "Retry local setup", exact: true });
    await page.locator("details.setup-manual summary").click();
    await page.getByLabel("Control plane URL").fill("http://127.0.0.1:4320");
    await page.getByLabel("Operator token").fill("fixture-token");
    await page.getByLabel("Project ID").fill("fixture-project");
    await retry.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("status")).toContainText("checking Docker availability…");
    await expect(retry).toHaveText("Retry local setup");
    await expect(retry).toBeFocused();
    await page.evaluate(() => window.__publishBootstrapStatus({ phase: "starting", step: { step: "postgres-ready", status: "started" } }));
    await expect(page.getByRole("status")).toContainText("starting the local database…");
    const progressButtonColors = await retry.evaluate((element) => {
      const style = getComputedStyle(element);
      const card = element.closest(".setup-card");
      return {
        foreground: style.color,
        background: style.backgroundColor,
        surface: card === null ? "" : getComputedStyle(card).backgroundColor,
      };
    });
    expect(
      contrastRatio(progressButtonColors.foreground, progressButtonColors.background),
      "progress button text contrast",
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(progressButtonColors.background, progressButtonColors.surface),
      "progress button boundary contrast",
    ).toBeGreaterThanOrEqual(3);
    await expect.poll(() => page.evaluate(() => window.__bootstrapRetryCount)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__completeBootstrapRetry !== undefined)).toBe(true);
    await page.evaluate(() => window.__completeBootstrapRetry?.("failure"));

    await expect(page.getByRole("alert")).toContainText("Docker is unavailable");
    await expect(page.getByRole("status")).toContainText("Local setup did not complete.");
    await expect(retry).toBeFocused();
    await expect(retry).toBeEnabled();
    await expect(page.getByLabel("Control plane URL")).toHaveValue("http://127.0.0.1:4320");
    await expect(page.getByLabel("Operator token")).toHaveValue("fixture-token");
    await expect(page.getByLabel("Project ID")).toHaveValue("fixture-project");
  });

  test("moves focus to the workspace main landmark after fixture bootstrap succeeds", async ({ page, baseURL }) => {
    await openFixture(page, baseURL);
    const retry = page.getByRole("button", { name: "Retry local setup", exact: true });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("checking Docker availability…");
    await expect.poll(() => page.evaluate(() => window.__completeBootstrapRetry !== undefined)).toBe(true);
    await page.evaluate(() => window.__completeBootstrapRetry?.("success"));

    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    await expect(page.getByRole("main", { name: "Maestro workspace" })).toBeFocused();
    await expect(page.getByRole("heading", { name: "Set up Maestro" })).toHaveCount(0);
  });

  test("keeps startup progress when an older terminal refresh resolves afterward", async ({ page, baseURL }) => {
    await openFixture(page, baseURL);
    await expect(page.getByRole("button", { name: "Retry local setup", exact: true })).toBeVisible();
    await page.evaluate(() => {
      window.__delayConnectionReads = true;
      window.__publishBootstrapStatus({ phase: "setup-required", reason: "Older failure", canRetryLocal: true });
      window.__publishBootstrapStatus({ phase: "starting", step: { step: "docker-check", status: "started" } });
    });
    await expect.poll(() => page.evaluate(() => window.__releaseConnectionReads !== undefined)).toBe(true);
    await page.evaluate(() => {
      window.__releaseConnectionReads?.();
      window.__releaseConnectionReads = undefined;
    });

    await expect(page.getByRole("heading", { name: "Starting local workspace…" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("checking Docker availability…");
  });

  test("sets the document language to the selected Korean locale", async ({ page, baseURL }) => {
    await openFixture(page, baseURL, "?locale=ko");
    await expect(page.getByRole("heading", { name: "Maestro 설정" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  });

  for (const theme of ["light", "dark"]) {
    test(`${theme} recovery screen has no axe violations`, async ({ page, baseURL }) => {
      await openFixture(page, baseURL);
      await expect(page.getByRole("heading", { name: "Set up Maestro" })).toBeVisible();
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await expectAxeClean(page);
    });
  }

  test("announces localized active and completed bootstrap steps in Korean", async ({ page, baseURL }) => {
    await openFixture(page, baseURL, "?locale=ko");
    const retry = page.getByRole("button", { name: "로컬 설정 다시 시도", exact: true });
    await retry.click();
    await expect(page.getByRole("status")).toContainText("Docker 사용 가능 여부 확인 중…");
    await page.evaluate(() =>
      window.__publishBootstrapStatus({
        phase: "starting",
        step: { step: "postgres-ready", status: "started", message: "Starting database" },
      }),
    );
    await expect(page.getByRole("status")).toContainText("로컬 데이터베이스 시작 중…");
    await page.evaluate(() =>
      window.__publishBootstrapStatus({
        phase: "starting",
        step: { step: "postgres-ready", status: "completed", message: "Embedded database is ready" },
      }),
    );
    await expect(page.getByRole("status")).toContainText("로컬 데이터베이스가 준비되었습니다.");
    await expect.poll(() => page.evaluate(() => window.__completeBootstrapRetry !== undefined)).toBe(true);
    await page.evaluate(() => window.__completeBootstrapRetry?.("failure"));
    await expect(page.getByRole("status")).toContainText("로컬 설정을 완료하지 못했습니다.");
  });

  test("keeps recovery copy and the primary action at WCAG AA contrast", async ({ page, baseURL }) => {
    await openFixture(page, baseURL);
    for (const selector of [".setup-hint", ".setup-recovery-hint", ".setup-manual-hint"]) {
      const colors = await page.locator(selector).evaluate((element) => {
        const card = element.closest(".setup-card");
        return { foreground: getComputedStyle(element).color, background: card === null ? "" : getComputedStyle(card).backgroundColor };
      });
      expect(contrastRatio(colors.foreground, colors.background), `${selector} contrast`).toBeGreaterThanOrEqual(4.5);
    }
    const buttonColors = await page.locator(".setup-retry-button").evaluate((element) => {
      const style = getComputedStyle(element);
      const card = element.closest(".setup-card");
      return {
        foreground: style.color,
        background: style.backgroundColor,
        surface: card === null ? "" : getComputedStyle(card).backgroundColor,
      };
    });
    expect(contrastRatio(buttonColors.foreground, buttonColors.background), "retry button text contrast").toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(buttonColors.background, buttonColors.surface), "retry button boundary contrast").toBeGreaterThanOrEqual(3);
  });

  for (const theme of ["light", "dark"]) {
    test(`${theme} manual-only setup keeps the Connect action at WCAG AA contrast`, async ({ page, baseURL }) => {
      await openFixture(page, baseURL, "?retry=unavailable");
      await expect(page.getByRole("heading", { name: "Set up Maestro" })).toBeVisible();
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await expect(page.getByText(/Start Docker/)).toBeVisible();
      await page.locator("details.setup-manual summary").click();
      const button = page.getByRole("button", { name: "Connect", exact: true });
      const colors = await button.evaluate((element) => {
        const style = getComputedStyle(element);
        const card = element.closest(".setup-card");
        return {
          foreground: style.color,
          background: style.backgroundColor,
          surface: card === null ? "" : getComputedStyle(card).backgroundColor,
        };
      });
      expect(contrastRatio(colors.foreground, colors.background), `${theme} manual Connect text contrast`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.background, colors.surface), `${theme} manual Connect boundary contrast`).toBeGreaterThanOrEqual(3);
      await expectAxeClean(page);
    });
  }

  test("shows a strong focus ring on the manual URL input", async ({ page, baseURL }) => {
    await openFixture(page, baseURL);
    const manualSummary = page.locator("details.setup-manual summary");
    await manualSummary.focus();
    await page.keyboard.press("Enter");
    const url = page.getByLabel("Control plane URL");
    await page.keyboard.press("Tab");
    await expect(url).toBeFocused();
    await expect(url).toHaveCSS("outline-style", "solid");
    const outlineWidth = await url.evaluate((element) => Number.parseFloat(getComputedStyle(element).outlineWidth));
    expect(outlineWidth).toBeGreaterThanOrEqual(2);
  });

  test("does not retry local setup while a manual connection save is pending", async ({ page, baseURL }) => {
    await openFixture(page, baseURL);
    await page.locator("details.setup-manual summary").click();
    await page.getByLabel("Operator token").fill("fixture-token");
    await page.getByLabel("Project ID").fill("fixture-project");
    await page.evaluate(() => {
      window.__delayConfigSave = true;
    });
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__releaseConfigSave !== undefined)).toBe(true);

    const retry = page.getByRole("button", { name: "Retry local setup", exact: true });
    await expect(retry).toHaveAttribute("aria-disabled", "true");
    await retry.click({ force: true });
    await expect.poll(() => page.evaluate(() => window.__bootstrapRetryCount)).toBe(0);

    await page.evaluate(() => window.__releaseConfigSave?.());
    await expect(page.getByRole("main", { name: "Maestro workspace" })).toBeFocused();
    await expect(page.getByRole("heading", { name: "Set up Maestro" })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__manualConnectCount)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__bootstrapRetryCount)).toBe(0);
  });

  test("renders the connected workspace after the fixture bridge saves a local connection", async ({ page, baseURL }) => {
    await openFixture(page, baseURL);
    await page.locator("details.setup-manual summary").click();
    await page.getByLabel("Operator token").fill("fixture-token");
    await page.getByLabel("Project ID").fill("fixture-project");
    await page.getByRole("button", { name: "Connect", exact: true }).click();

    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    await expect(page.getByRole("main", { name: "Maestro workspace" })).toBeFocused();
    await expect(page.getByRole("heading", { name: "Set up Maestro" })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__manualConnectCount)).toBe(1);
  });

  test("keeps recovery controls reachable when the startup error is extremely long", async ({ page, baseURL }) => {
    const wideViewport = { width: 1800, height: 1000 };
    await page.setViewportSize(wideViewport);
    await openFixture(page, baseURL);
    await expect(page.getByRole("heading", { name: "Set up Maestro" })).toBeVisible();
    const longError = "x".repeat(65_598);
    await page.evaluate((reason) => {
      window.__publishBootstrapStatus({ phase: "setup-required", reason, canRetryLocal: true });
    }, longError);
    await expect(page.getByRole("alert")).not.toContainText("Docker is required for local automatic setup but is not available");

    const alertText = await page.getByRole("alert").textContent();
    expect(alertText?.length ?? 0).toBeLessThan(512);
    expect(alertText).not.toContain(longError.slice(0, 128));
    await page.locator("details.setup-manual summary").click();

    for (const viewport of [wideViewport, { width: 360, height: 720 }]) {
      await page.setViewportSize(viewport);
      const card = await page.locator(".setup-card").boundingBox();
      expect(card).not.toBeNull();
      expect(card!.x).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width).toBeLessThanOrEqual(viewport.width);

      for (const selector of [".setup-retry-button", "#setup-api-url", "#setup-token", "#setup-project-id", ".setup-submit"]) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
      }
    }
  });
});
