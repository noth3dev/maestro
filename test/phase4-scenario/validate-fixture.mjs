import { assertPhase4ScenarioFixture } from "./fixture.mjs";

const root = process.argv[2];
if (!root) throw new Error("usage: node validate-fixture.mjs <fixture-root>");
const result = await assertPhase4ScenarioFixture(root);
console.log(JSON.stringify({ root: result.root, format: result.manifest.format, scenarios: result.manifest.scenarios }));
