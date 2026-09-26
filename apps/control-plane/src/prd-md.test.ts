import { describe, expect, it } from "vitest";
import { TaskContractSubstanceSchema } from "@maestro/contracts";
import { PrdMarkdownError, readPrdSections, taskContractFromPrd } from "./prd-md.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const complete = `# Personal homepage — PRD

## Goal
Ship a one-page personal homepage.

## Users
- Recruiters skimming projects

## Requirements
- Show a short bio
- [x] Link to selected projects

## Success metrics
- Page renders without a build step

## Non-goals
- No blog engine

## Risks
- Stale project links

## Repository
\`/work/homepage\`

## Base revision
abc1234

## Data boundary
Public content only

## Departments
- Engineering
- design department

## Notes
\`\`\`md
## Goal
not a heading inside code
\`\`\`
`;

describe("prd.md", () => {
  it("builds a valid Task Contract substance with groups derived from departments", () => {
    const substance = taskContractFromPrd({ markdown: complete, projectId, evidence: ["workspace@abc:prd.md#aa"], documents: ["prd.md"] });
    expect(() => TaskContractSubstanceSchema.parse(substance)).not.toThrow();
    expect(substance).toMatchObject({
      desiredOutcome: "Ship a one-page personal homepage.",
      userVisibleBehavior: ["Show a short bio", "Link to selected projects"],
      successCriteria: ["Page renders without a build step"],
      scope: [`Project ${projectId}`, "For: Recruiters skimming projects"],
      nonGoals: ["No blog engine"],
      knownEdgeCases: ["Stale project links"],
      project: { projectId, repository: "/work/homepage", immutableBaseRevision: "abc1234", dataBoundary: "Public content only" },
      expectedDepartments: ["engineering", "design"],
      expectedGroups: ["tech", "product"],
    });
  });

  it("accepts the earlier task.md headings as aliases", () => {
    expect(readPrdSections("## Outcome\nShip it\n## Success criteria\n- ok").goal).toBe("Ship it");
  });

  it("names every missing required section and rejects unknown departments", () => {
    expect(() => taskContractFromPrd({ markdown: "## Goal\nx\n", projectId, evidence: ["e"], documents: [] })).toThrow(
      new PrdMarkdownError("prd.md is missing: Requirements, Success metrics, Repository, Base revision, Data boundary, Departments"),
    );
    const unknown = complete.replace("- Engineering\n- design department", "- Marketing");
    expect(() => taskContractFromPrd({ markdown: unknown, projectId, evidence: ["e"], documents: [] })).toThrow("Departments must name at least one of");
  });

  it("ignores headings inside fenced code", () => {
    expect(readPrdSections(complete).goal).toBe("Ship a one-page personal homepage.");
  });
});
