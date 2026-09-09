export type ActionClassification = "ordinary" | "critical" | "forbidden" | "ambiguous";

const ACTION_CLASSIFICATIONS: Readonly<Record<string, ActionClassification>> = {
  "project.file.read": "ordinary",
  "project.file.edit": "ordinary",
  "project.test.run": "ordinary",
  "project.shell.run": "ordinary",
  "project.environment.change": "ordinary",
  "git.local.branch.create": "ordinary",
  "git.local.branch.advance": "ordinary",
  "git.local.commit": "ordinary",
  "git.local.revision.read": "ordinary",
  "git.local.worktree.create": "ordinary",
  "git.local.worktree.remove": "ordinary",
  "browser.navigate": "ordinary",
  "browser.click": "ordinary",
  "browser.fill": "ordinary",
  "browser.get_text": "ordinary",
  "browser.screenshot": "ordinary",
  "git.remote.push": "critical",
  "deployment.release": "critical",
  "external.send": "critical",
  "permanent.delete": "critical",
  "payment.spend": "critical",
  "authority.change": "critical",
  "external.connect": "critical",
  "system.policy.bypass": "forbidden",
};

export function classifyAction(action: string): ActionClassification {
  return ACTION_CLASSIFICATIONS[action] ?? "ambiguous";
}
