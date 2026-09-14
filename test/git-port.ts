import { AuthorizedEffectExecutor, type AuthorityRepository } from "@maestro/authority";
import { createLocalGitPort } from "@maestro/git-adapter";

const repository: AuthorityRepository = {
  async load(request) {
    return [{
      recordId: `test-grant-${request.action}`,
      kind: "grant",
      commandId: null,
      projectId: request.projectId,
      actorId: request.actorId,
      goalId: request.goalId,
      action: request.action,
      target: request.target,
      policyVersion: request.policyVersion,
      budgetEffectCents: request.budgetEffectCents,
      expiresAt: new Date("2999-01-01T00:00:00Z"),
    }];
  },
  async appendDecision() {},
  async recheckControl() { return { effect: "allow" }; },
};

/** Explicitly authorized real-Git port used only by integration tests. */
export const localGitPort = createLocalGitPort({
  authority: new AuthorizedEffectExecutor(repository, () => new Date("2029-01-01T00:00:00Z")),
  context: {
    commandId: "test-git-command",
    projectId: "test-git-project",
    actorId: "test-git-actor",
    goalId: "test-git-goal",
    policyVersion: 1,
    budgetEffectCents: 0,
    controlEpoch: "1",
  },
});
