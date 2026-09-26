import { describe, expect, it } from "vitest";
import { TaskContractSubstanceSchema } from "@maestro/contracts";
import { TaskMarkdownError, readTaskMarkdownSections, taskContractFromMarkdown } from "./task-md.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const complete = `# Personal homepage

## Outcome
Ship a one-page personal homepage.

## Success criteria
- Page renders a bio
- [x] Project links open in a new tab

## Repository
\`/work/homepage\`

## Base revision
abc1234

## Data boundary
Public content only

## Groups
- product

## Departments
- engineering
- design

## Budget
$5

## Notes
Ignored section
\`\`\`md
## Outcome
not a heading inside code
\`\`\`
`;

describe("task.md", () => {
  it("builds a valid Task Contract substance with workspace evidence", () => {
    const substance = taskContractFromMarkdown({
      markdown: complete,
      projectId,
      evidence: ["workspace@abc:task.md#aa", "workspace@abc:plan00.md#bb"],
      documents: ["plan00.md", "task.md"],
    });
    expect(() => TaskContractSubstanceSchema.parse(substance)).not.toThrow();
    expect(substance).toMatchObject({
      desiredOutcome: "Ship a one-page personal homepage.",
      successCriteria: ["Page renders a bio", "Project links open in a new tab"],
      project: { projectId, repository: "/work/homepage", immutableBaseRevision: "abc1234", dataBoundary: "Public content only" },
      expectedGroups: ["product"],
      expectedDepartments: ["engineering", "design"],
      liveEvidence: ["workspace@abc:task.md#aa", "workspace@abc:plan00.md#bb"],
      approvedPreviewReferences: ["plan00.md", "task.md"],
      budget: { ceiling: "$5" },
    });
  });

  it("names every missing required section", () => {
    expect(() => taskContractFromMarkdown({ markdown: "## Outcome\nx\n", projectId, evidence: ["e"], documents: [] })).toThrow(
      new TaskMarkdownError("task.md is missing: Success criteria, Repository, Base revision, Data boundary, Groups, Departments"),
    );
  });

  it("ignores headings inside fenced code and unknown sections", () => {
    expect(readTaskMarkdownSections(complete).outcome).toBe("Ship a one-page personal homepage.");
  });
});
