import { createApiClient, type GoalEvent, type GoalResult } from "@maestro/api-client";
import type { SecretaryConfig } from "./config.js";

export interface GoalPageData {
  goal: GoalResult;
  events: GoalEvent[];
}

type Fetch = typeof globalThis.fetch;

export async function loadGoalPageData(config: SecretaryConfig, fetch: Fetch = globalThis.fetch): Promise<GoalPageData> {
  const client = createApiClient({ baseUrl: config.apiUrl, token: config.token, fetch });
  const [goal, page] = await Promise.all([
    client.getGoal(config.goalId, { projectId: config.projectId }),
    client.listEvents({ projectId: config.projectId, after: "0" }),
  ]);
  return { goal, events: page.events.filter((event) => event.goalId === goal.goalId) };
}

export function GoalPage({ data, error }: { data?: GoalPageData; error?: string }) {
  if (error) return <main><h1>Secretary Office</h1><section aria-labelledby="error-heading" role="alert"><h2 id="error-heading">Unable to load Goal</h2><p>{error}</p></section></main>;
  if (!data) return <main aria-busy="true"><h1>Secretary Office</h1><p>Loading durable Goal state…</p></main>;
  const { goal, events } = data;
  return <main>
    <header><h1>Secretary Office</h1><p>Durable control-plane view</p></header>
    <section aria-labelledby="goal-heading">
      <h2 id="goal-heading">Goal</h2>
      <dl><dt>Goal ID</dt><dd>{goal.goalId}</dd><dt>State</dt><dd>{goal.state}</dd><dt>Version</dt><dd>Version {goal.version}</dd></dl>
    </section>
    <section aria-labelledby="history-heading">
      <h2 id="history-heading">Event history and evidence references</h2>
      {events.length === 0 ? <p>No durable events yet.</p> : <ol>{events.map((event) => <li key={event.eventId}><strong>{event.eventType}</strong> <span>cursor {event.cursor}; version {event.aggregateVersion}; {event.occurredAt}</span><pre aria-label={`Evidence references for ${event.eventType}`}>{JSON.stringify(event.payload, null, 2)}</pre></li>)}</ol>}
    </section>
  </main>;
}
