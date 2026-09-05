import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface GrantFenceState { fence: string; sequence: number; }
interface PersistedFenceState { version: 1; deviceId: string; grants: Record<string, GrantFenceState>; }

export class DeviceFenceState {
  private readonly grants = new Map<string, GrantFenceState>();
  private constructor(private readonly path: string, private readonly deviceId: string) {}

  static async open(path: string, deviceId: string): Promise<DeviceFenceState> {
    const state = new DeviceFenceState(path, deviceId);
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as PersistedFenceState;
      if (parsed.version !== 1 || parsed.deviceId !== deviceId || !parsed.grants || typeof parsed.grants !== "object") throw new Error("invalid fence state");
      for (const [grantId, value] of Object.entries(parsed.grants)) {
        if (/^[1-9][0-9]*$/.test(value.fence) && Number.isSafeInteger(value.sequence) && value.sequence >= 0) state.grants.set(grantId, { fence: value.fence, sequence: value.sequence });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Device fence state is invalid", { cause: error });
      await state.persist();
    }
    return state;
  }

  previous(grantId: string): GrantFenceState { return this.grants.get(grantId) ?? { fence: "0", sequence: 0 }; }
  async advance(grantId: string, fence: string, sequence: number): Promise<void> {
    const prior = this.previous(grantId);
    const nextFence = BigInt(fence) > BigInt(prior.fence) ? fence : prior.fence;
    const nextSequence = BigInt(fence) > BigInt(prior.fence) || (BigInt(fence) === BigInt(prior.fence) && sequence > prior.sequence) ? sequence : prior.sequence;
    this.grants.set(grantId, { fence: nextFence, sequence: nextSequence });
    await this.persist();
  }
  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, deviceId: this.deviceId, grants: Object.fromEntries(this.grants) }), { mode: 0o600 });
    await rename(temporary, this.path);
  }
}
