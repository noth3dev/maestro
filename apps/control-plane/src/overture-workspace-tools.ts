import { z } from "zod";
import { ToolRegistry, type ToolDefinition, type ToolExecutionResult } from "@maestro/agent-runtime";
import { SessionWorkspaceFileNotFoundError, SessionWorkspacePathError, type SessionWorkspace } from "./session-workspace.js";

const ResultSchema = z.object({ status: z.enum(["ok", "error", "unknown"]), content: z.string() }).strict();
const PathInputSchema = z.object({ path: z.string().min(1).max(256) }).strict();
const WriteInputSchema = z.object({ path: z.string().min(1).max(256), content: z.string().max(262_144), summary: z.string().max(200).optional() }).strict();
const EmptyInputSchema = z.object({}).strict();

const LIST_LIMIT = 200;
const READ_LIMIT = 32_000;

function failure(error: unknown): ToolExecutionResult {
  if (error instanceof SessionWorkspacePathError || error instanceof SessionWorkspaceFileNotFoundError) return { status: "error", content: error.message };
  throw error;
}

/**
 * Workspace tools bound to exactly one Overture conversation. The model
 * chooses file paths only; the project and conversation come from the host.
 */
export function createOvertureWorkspaceTools(options: {
  readonly workspace: SessionWorkspace;
  readonly projectId: string;
  readonly conversationId: string;
  /** Records a successful write so the operator can see what changed. */
  readonly onWrite?: (write: { path: string; revision: string | null }) => void;
}): ToolDefinition[] {
  const { workspace, projectId, conversationId } = options;
  const base = { version: "1", outputSchema: ResultSchema, allowsParallel: false, outboundDataClass: "workspace" as const };
  return [
    {
      ...base,
      name: "list-workspace-files",
      description: "List the files in this conversation's session workspace.",
      inputSchema: EmptyInputSchema,
      modelInputSchema: { type: "object", additionalProperties: false, properties: {} },
      async execute() {
        const listing = await workspace.list(projectId, conversationId);
        if (listing.files.length === 0) return { status: "ok", content: "The workspace is empty." };
        const lines = listing.files.slice(0, LIST_LIMIT).map((file) => `${file.path} (${file.size} bytes)`);
        if (listing.files.length > LIST_LIMIT) lines.push(`… ${listing.files.length - LIST_LIMIT} more`);
        return { status: "ok", content: lines.join("\n") };
      },
    },
    {
      ...base,
      name: "read-workspace-file",
      description: "Read one UTF-8 file from this conversation's session workspace.",
      inputSchema: PathInputSchema,
      modelInputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string", description: "Workspace-relative path, e.g. plan00.md" } },
        required: ["path"],
      },
      async execute(args) {
        const { path } = PathInputSchema.parse(args);
        try {
          const file = await workspace.read(projectId, conversationId, path);
          const content = file.content.length > READ_LIMIT ? `${file.content.slice(0, READ_LIMIT)}\n… (truncated)` : file.content;
          return { status: "ok", content };
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      ...base,
      name: "write-workspace-file",
      description:
        "Create or replace one whole file in this conversation's session workspace. Use .md for documents and .canvas (SVG markup) for drawings. Each write is recorded as a commit.",
      inputSchema: WriteInputSchema,
      modelInputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "Workspace-relative path such as plan00.md, research/api.md, or design/home.canvas" },
          content: { type: "string", description: "The complete new file content" },
          summary: { type: "string", description: "One-line description of the change" },
        },
        required: ["path", "content"],
      },
      async execute(args) {
        const input = WriteInputSchema.parse(args);
        try {
          const result = await workspace.write(projectId, conversationId, [{ path: input.path, content: input.content }], input.summary ?? `Update ${input.path}`);
          options.onWrite?.({ path: input.path, revision: result.revision });
          return { status: "ok", content: `Wrote ${input.path}${result.revision === null ? "" : ` at ${result.revision.slice(0, 12)}`}.` };
        } catch (error) {
          return failure(error);
        }
      },
    },
  ];
}

/** A registry holding only the workspace tools bound to one conversation. */
export function overtureWorkspaceToolRegistry(options: Parameters<typeof createOvertureWorkspaceTools>[0]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of createOvertureWorkspaceTools(options)) registry.register(tool);
  return registry;
}
