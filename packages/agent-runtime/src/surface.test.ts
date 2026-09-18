import { describe, expect, it } from "vitest";

describe("agent-runtime surface", () => {
  it("pins the barrel export list", async () => {
    const surface = await import("./index.js");
    expect(Object.keys(surface).sort()).toMatchInlineSnapshot(`
      [
        "DEFAULT_CONCERTMASTER_PERSONA",
        "DEFAULT_MAESTRO_RUNTIME_PERSONA",
        "IPYTHON_PROTOCOL_VERSION",
        "IPYTHON_PYTHON_BOOTSTRAP",
        "IpPythonKernelBusyError",
        "IpPythonProtocolError",
        "MAX_FRAME_BYTES",
        "NATIVE_REFINEMENT_COMPONENTS",
        "NativeRefinementError",
        "OVERTURE_TASK_CONTRACT_CREATE_TOOL",
        "ProviderRegistry",
        "ToolRegistry",
        "buildMaestroSystemPrompt",
        "createIpPythonGitRevisionAdapter",
        "createIpPythonJsonLinesTransport",
        "createIpPythonKernel",
        "createIpPythonLocalEffectsGateway",
        "createIpPythonOwnedProcessChannel",
        "createIpPythonParentWatchdog",
        "createIpPythonProcessKernel",
        "createIpPythonReadOnlyGateway",
        "createIpPythonSessionManager",
        "createIpPythonTool",
        "createIpPythonTwoStageProcessKernel",
        "createLocalHostRequestHandler",
        "createMaestroAgentRuntime",
        "createNativeRefinementAdapter",
        "createReadOnlyHostRequestHandler",
        "createTaskContractDraftingTool",
        "createUnavailableIpPythonKernel",
        "deriveIpPythonToolCallCommandId",
        "deriveTaskContractId",
        "executeIpPythonBlockInTwoStages",
        "formatModelRef",
        "normalizeToolArguments",
        "parseIpPythonFrame",
        "parseModelRef",
        "readIpPythonParentIdentity",
        "reapIpPythonProcessGroup",
        "sessionBindingKey",
      ]
    `);
  });
});
