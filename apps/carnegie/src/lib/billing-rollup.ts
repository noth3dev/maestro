import type { BillingReadModel, ProjectSummary } from "@maestro/contracts";

export interface ProjectBilling {
  readonly projectId: string;
  readonly name: string;
  readonly goalCount: number;
  readonly totals: BillingReadModel["totals"];
}

export interface GlobalBilling {
  readonly dailySpend: BillingReadModel["dailySpend"];
  readonly totals: BillingReadModel["totals"];
  readonly goalCount: number;
  /** Projects by spend, highest first. */
  readonly projects: readonly ProjectBilling[];
}

/** Billing is global: sum every project's rollup, day by day, and keep a per-project breakdown. */
export function combineBilling(entries: readonly { readonly project: Pick<ProjectSummary, "projectId" | "name">; readonly billing: BillingReadModel }[]): GlobalBilling {
  const byDate = new Map<string, number>();
  const totals = { budgetCents: 0, reservedCents: 0, costCents: 0 };
  let goalCount = 0;
  for (const { billing } of entries) {
    for (const day of billing.dailySpend) byDate.set(day.date, (byDate.get(day.date) ?? 0) + day.costCents);
    totals.budgetCents += billing.totals.budgetCents;
    totals.reservedCents += billing.totals.reservedCents;
    totals.costCents += billing.totals.costCents;
    goalCount += billing.goals.length;
  }
  return {
    dailySpend: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, costCents]) => ({ date, costCents })),
    totals,
    goalCount,
    projects: entries
      .map(({ project, billing }) => ({ projectId: project.projectId, name: project.name, goalCount: billing.goals.length, totals: billing.totals }))
      .sort((a, b) => b.totals.costCents - a.totals.costCents || a.name.localeCompare(b.name)),
  };
}
