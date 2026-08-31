export interface PrimeSdkInfo {
  version: string;
  supportsSessionFactory: boolean;
  supportsInMemorySessions: boolean;
}

export async function inspectPrimeSdk(
  expectedVersion = "0.8.0",
): Promise<PrimeSdkInfo> {
  const sdk = await import("prime-agent");
  if (sdk.VERSION !== expectedVersion) {
    throw new Error(
      `Unsupported Prime Agent SDK: expected ${expectedVersion}, got ${sdk.VERSION}`,
    );
  }

  return {
    version: sdk.VERSION,
    supportsSessionFactory: typeof sdk.createAgentSession === "function",
    supportsInMemorySessions: typeof sdk.SessionManager.inMemory === "function",
  };
}
