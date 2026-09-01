import { parseSecretaryConfig } from "../src/config.js";
import { GoalPage, loadGoalPageData } from "../src/goal-page.js";

export const dynamic = "force-dynamic";

export default async function Page() {
  try {
    return <GoalPage data={await loadGoalPageData(parseSecretaryConfig(process.env))} />;
  } catch (error) {
    return <GoalPage error={error instanceof Error ? error.message : "Control plane request failed"} />;
  }
}
