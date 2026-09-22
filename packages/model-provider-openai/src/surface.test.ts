import { describe, expect, it } from "vitest";

describe("model-provider-openai surface", () => {
  it("pins the barrel export list", async () => {
    const surface = await import("./index.js");
    expect(Object.keys(surface).sort()).toMatchInlineSnapshot(`
      [
        "CodexAppServerClient",
        "CodexAppServerError",
        "CodexOAuthClient",
        "CodexResponsesError",
        "OpenAiProviderError",
        "createCodexAppServerPlugin",
        "createCodexResponsesPlugin",
        "createOpenAiPlugin",
        "resolveCodexAppServerCommand",
      ]
    `);
  });
});
