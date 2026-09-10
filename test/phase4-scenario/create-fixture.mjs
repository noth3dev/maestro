import { createPhase4ScenarioFixture } from "./fixture.mjs";

const root = process.argv[2];
const fixture = await createPhase4ScenarioFixture(root ? { root } : {});
console.log(fixture.root);
