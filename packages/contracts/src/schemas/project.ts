import { z } from "zod";
import { UuidSchema } from "./common.js";

/** A named project: `home` is the operator's global workspace; the others hold Goals from approved PRDs. */
export const ProjectSummarySchema = z
  .object({
    projectId: UuidSchema,
    name: z.string().min(1).max(120),
    kind: z.enum(["home", "project"]),
    createdAt: z.string(),
    goalCount: z.number().int().nonnegative(),
    activeGoalCount: z.number().int().nonnegative(),
  })
  .strict();
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectCatalogSchema = z.object({ projects: z.array(ProjectSummarySchema) }).strict();
export type ProjectCatalog = z.infer<typeof ProjectCatalogSchema>;

export const ProjectNameInputSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();
export type ProjectNameInput = z.infer<typeof ProjectNameInputSchema>;
