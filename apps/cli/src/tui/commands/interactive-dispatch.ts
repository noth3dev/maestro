import type { ApiClient } from "@maestro/api-client";
import type { ParsedCommand } from "./parser.js";
import { executeWriteCommand, type WriteCommandContext, type WriteCommandResult } from "./write-commands.js";

/** The write dispatch seam used by the interactive submit handler. */
export function dispatchInteractiveWriteCommand(context: WriteCommandContext, command: ParsedCommand): Promise<WriteCommandResult> {
  return executeWriteCommand(context, command);
}

export type InteractiveWriteContext = WriteCommandContext & { readonly client: ApiClient };
