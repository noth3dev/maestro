import type { ParsedCommand } from "../../../commands/parser.js";
import { executeBasicShellCommand, latestCopyableTranscriptText } from "../../../basic-shell.js";
import { copyToClipboard } from "../../../../external-url.js";
import { MAESTRO_VERSION } from "../../../../version.js";
import type { TuiController } from "../../controller.js";

export async function handleShellCommand(c: TuiController, parsed: ParsedCommand): Promise<void> {
  await executeBasicShellCommand(parsed.name, {
    clearTranscript: () => {
      c.resetConversationStream("transcript");
      c.view.render();
    },
    stop: () => c.lifecycle.stop(),
    getLatestTranscriptText: () => latestCopyableTranscriptText(c.conversation),
    copyToClipboard: c.options.io.copyToClipboard ?? copyToClipboard,
    write: c.view.append,
    version: MAESTRO_VERSION,
  });
}
