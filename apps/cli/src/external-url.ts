import { execFile as execFileCallback, spawn } from "node:child_process";
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

async function writeClipboard(command: string, args: readonly string[], text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error("clipboard command timed out")); }, 5_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error("clipboard command failed")); });
    child.stdin.end(text);
  });
}

/** Copies provider login URLs without putting them through a shell or argv. */
export async function copyToClipboard(text: string): Promise<void> {
  const commands: readonly [string, readonly string[]][] = process.platform === "darwin"
    ? [["pbcopy", []]]
    : process.platform === "win32"
      ? [["clip", []]]
      : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]], ["clip.exe", []]];
  let lastError: unknown;
  for (const [command, args] of commands) {
    try { await writeClipboard(command, args, text); return; }
    catch (error) { lastError = error; }
  }
  throw new Error(lastError instanceof Error ? lastError.message : "clipboard is unavailable");
}
