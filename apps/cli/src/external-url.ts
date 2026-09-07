import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export async function openExternalUrl(url: string): Promise<void> {
  const [command, args] = process.platform === "darwin"
    ? ["open", [url]]
    : process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : ["xdg-open", [url]];
  await execFile(command, args, { windowsHide: true, timeout: 10_000 });
}
