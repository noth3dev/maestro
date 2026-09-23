import { describe, expect, it } from "vitest";
import {
  AppendOvertureMessageInputSchema,
  OvertureArtifactSchema,
  OverturePlanDocumentSchema,
  OverturePlanManifestSchema,
  OvertureRunSchema,
  OvertureRoleAssignmentSchema,
} from "./schemas/overture.js";

const ids = {
  runId: "22222222-2222-4222-8222-222222222222",
  conversationId: "33333333-3333-4333-8333-333333333333",
  projectId: "11111111-1111-4111-8111-111111111111",
  messageId: "44444444-4444-4444-8444-444444444444",
};

const baseDocument = {
  documentId: "55555555-5555-4555-8555-555555555555",
  projectId: ids.projectId,
  runId: ids.runId,
  path: "plan00.md",
  kind: "project" as const,
  version: 1,
  content: "# Project blueprint",
  contentHash: "a".repeat(64),
  sourceRefs: [],
  dependencies: [],
};

describe("Overture contracts", () => {
  it("accepts a goal-less run with explicit role assignments", () => {
    const result = OvertureRunSchema.parse({
      runId: ids.runId,
      conversationId: ids.conversationId,
      projectId: ids.projectId,
      state: "collecting",
      version: 1,
      roleTaxonomyVersion: 2,
      goalId: null,
      executionPhase: "overture",
      taskContractRef: null,
      planManifestHash: null,
      taskContractId: null,
      roles: [
        { roleId: "conversation-lead", status: "active", modelRef: "openai/gpt-5" },
        { roleId: "task-editor", status: "queued", modelRef: null },
      ],
    });
    expect(result.goalId).toBeNull();
  });

  it("rejects role messages carrying unknown fields or secret-like content", () => {
    expect(() =>
      AppendOvertureMessageInputSchema.parse({
        projectId: ids.projectId,
        runId: ids.runId,
        conversationId: ids.conversationId,
        turnId: ids.messageId,
        actor: "operator",
        modelRef: null,
        content: "password: nope",
        commandId: ids.messageId,
      }),
    ).toThrow(/sensitive|secret/i);
    expect(() =>
      AppendOvertureMessageInputSchema.parse({
        projectId: ids.projectId,
        runId: ids.runId,
        conversationId: ids.conversationId,
        turnId: ids.messageId,
        actor: "operator",
        modelRef: null,
        content: "<thinking>private</thinking>",
        commandId: ids.messageId,
        extra: true,
      }),
    ).toThrow();
  });

  it("requires valid plan grammar and SHA-256 content identities", () => {
    expect(() => OverturePlanDocumentSchema.parse(baseDocument)).not.toThrow();
    expect(() => OverturePlanDocumentSchema.parse({ ...baseDocument, path: "plan1.md", contentHash: "b".repeat(64) })).toThrow();
    expect(() =>
      OverturePlanManifestSchema.parse({
        schemaVersion: 1,
        projectId: ids.projectId,
        runId: ids.runId,
        documents: [
          {
            documentId: baseDocument.documentId,
            path: baseDocument.path,
            kind: baseDocument.kind,
            version: baseDocument.version,
            contentHash: baseDocument.contentHash,
            sourceRefs: [],
            dependencies: [],
          },
        ],
        manifestHash: "c".repeat(64),
      }),
    ).not.toThrow();
    expect(() =>
      OvertureArtifactSchema.parse({
        artifactId: ids.messageId,
        projectId: ids.projectId,
        runId: ids.runId,
        kind: "security_finding",
        title: "Finding",
        content: "safe",
        contentHash: "d".repeat(64),
        sourceRefs: [],
      }),
    ).not.toThrow();
  });

  it("does not widen a role assignment into execution authority", () => {
    const role = OvertureRoleAssignmentSchema.parse({ roleId: "task-editor", status: "active", modelRef: null });
    expect(role).toEqual({ roleId: "task-editor", status: "active", modelRef: null });
  });
});
