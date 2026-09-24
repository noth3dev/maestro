import { describe, expect, it } from "vitest";

describe("agent-runtime surface", () => {
  it("pins the barrel export list", async () => {
    const surface = await import("./index.js");
    expect(Object.keys(surface).sort()).toMatchInlineSnapshot(`
      [
        "DEFAULT_CONCERTMASTER_PERSONA",
        "DEFAULT_MAESTRO_RUNTIME_PERSONA",
        "HeadBriefParseError",
        "HeadBriefProviderUnavailableError",
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
        "createHeadBriefRuntime",
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
        "createOvertureRoleRuntime",
        "createReadOnlyHostRequestHandler",
        "createTaskContractDraftingTool",
        "createUnavailableIpPythonKernel",
        "deriveIpPythonToolCallCommandId",
        "deriveTaskContractId",
        "executeIpPythonBlockInTwoStages",
        "formatModelRef",
        "normalizeToolArguments",
        "parseIndependentBriefText",
        "parseIpPythonFrame",
        "parseModelRef",
        "readIpPythonParentIdentity",
        "reapIpPythonProcessGroup",
        "sessionBindingKey",
      ]
    `);
  });
});
