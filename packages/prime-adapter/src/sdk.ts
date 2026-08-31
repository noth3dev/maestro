export const PINNED_PRIME_AGENT_VERSION = "0.8.0";

export interface PrimeSdkInfo {
  version: string;
  supportsSessionFactory: true;
  supportsInMemorySessions: true;
}

export async function assertPrimeSdkCompatibility(): Promise<PrimeSdkInfo> {
  const sdk = await import("prime-agent");
  if (sdk.VERSION !== PINNED_PRIME_AGENT_VERSION) {
    throw new Error(
      `Unsupported Prime Agent SDK: expected ${PINNED_PRIME_AGENT_VERSION}, got ${sdk.VERSION}`,
    );
  }
  if (typeof sdk.createAgentSession !== "function") {
    throw new Error("Prime Agent SDK is missing createAgentSession");
  }
  if (typeof sdk.SessionManager?.inMemory !== "function") {
    throw new Error("Prime Agent SDK is missing SessionManager.inMemory");
  }
  return {
    version: sdk.VERSION,
    supportsSessionFactory: true,
    supportsInMemorySessions: true,
  };
}
