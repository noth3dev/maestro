import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Git } from "./Git.js";

type GitStateFixture = {
  state: {
    goalId: string;
    branch: { goalId: string; repositoryPath: string; branchName: string; baseRevision: string } | null;
    latestRevision: {
      revisionId: string;
      revisionNumber: number;
      goalId: string;
      repositoryPath: string;
      branchName: string;
      baseRevision: string;
      commitSha: string;
    } | null;
  };
  loading: boolean;
  error: string | undefined;
};

const gitState = vi.hoisted(() => ({
  value: null as unknown as GitStateFixture,
}));

vi.mock("../icons.js", () => ({ Icon: () => null }));
vi.mock("../connection.js", () => ({ useConnection: () => ({ config: { projectId: "11111111-1111-4111-8111-111111111111" } }) }));
vi.mock("../goals.js", () => ({ useGoals: () => ({ selectedGoalId: "22222222-2222-4222-8222-222222222222" }) }));
vi.mock("../useGitIntegrationState.js", () => ({ useGitIntegrationState: () => gitState.value }));
vi.stubGlobal("React", React);

beforeEach(() => {
  gitState.value = {
    state: {
      goalId: "22222222-2222-4222-8222-222222222222",
      branch: {
        goalId: "22222222-2222-4222-8222-222222222222",
        repositoryPath: "/repo/product",
        branchName: "maestro/goal/hero",
        baseRevision: "a".repeat(40),
      },
      latestRevision: {
        revisionId: "33333333-3333-4333-8333-333333333333",
        revisionNumber: 3,
        goalId: "22222222-2222-4222-8222-222222222222",
        repositoryPath: "/repo/product",
        branchName: "maestro/goal/hero",
        baseRevision: "a".repeat(40),
        commitSha: "b".repeat(40),
      },
    },
    loading: false,
    error: undefined,
  };
});

describe("Git integration view", () => {
  it("renders the server Git identity and durable revision fields", () => {
    const html = renderToStaticMarkup(<Git onBack={vi.fn()} />);

    expect(html).toContain("/repo/product");
    expect(html).toContain("maestro/goal/hero");
    expect(html).toContain("base revision");
    expect(html).toContain("frozen revision");
    expect(html).toContain("b".repeat(40));
    expect(html).toContain("Create Goal integration branch");
    expect(html).toContain("Create Worker worktree");
    expect(html).toContain("Advance Worker integration");
    expect(html).toContain("Freeze current integration revision");
  });

  it("keeps the freeze action disabled until the server reports a Goal branch", () => {
    gitState.value = { ...gitState.value, state: { ...gitState.value.state, branch: null, latestRevision: null } };
    const html = renderToStaticMarkup(<Git onBack={vi.fn()} />);

    expect(html).toContain("No Goal integration branch yet");
    expect(html).toContain("Freeze current integration revision");
    expect(html).toContain('disabled=""');
    expect(html).not.toContain("maestro/goal/hero");
  });
});
