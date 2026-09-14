import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PERSONA_AXES } from "@maestro/domain";
import { PersonaPanel, type PersonaInspectionModel } from "./PersonaPanel.js";

const profile = Object.fromEntries(PERSONA_AXES.map((axis, index) => [axis, 0.4 + index / 20])) as PersonaInspectionModel["profile"];
const model: PersonaInspectionModel = {
  roleId: "concertmaster", taskClass: "implementation", profile, version: 3,
  coreIdentity: { mission: "deliver truthful work", authority: ["coordinate"], truthfulness: "report evidence", safety: "escalate risk", prohibitedBehavior: ["invent evidence"] },
  taskClassAdjustment: { roleId: "concertmaster", taskClass: "implementation", version: 2, delta: { caution: 0.04 }, reason: "implementation needs review" },
  missionOverlay: { initiative: 0.02 },
  candidates: [{ candidateId: "candidate-1", version: 2, state: "candidate", changedAxes: ["caution"], decision: "pending", invalidated: true }],
  rollouts: [{ rolloutId: "rollout-1", status: "rolled_back", activeCandidateId: "candidate-1", activeVersion: 2, rollbackTarget: { candidateId: "prior-1", version: 1, contentHash: "hash" }, evidence: [{ kind: "automatic_rollback", evidenceId: "event-1" }] }],
};

describe("PersonaPanel", () => {
  it("shows the identity and three distinctive axes by default, with layers on expansion", () => {
    const html = renderToStaticMarkup(<PersonaPanel model={model} />);
    expect(html).toContain("deliver truthful work");
    expect(html).toContain("caution");
    expect(html).toContain("initiative");
    expect(html).toContain("conscientiousness");
    expect(html).not.toContain('data-axis="agreeableness"');
    expect(html).not.toContain("task-class adjustment");
    expect(html).not.toContain("learned version");
    const expanded = renderToStaticMarkup(<PersonaPanel model={model} expanded />);
    expect(expanded).toContain('data-axis="agreeableness"');
    expect(expanded).toContain("task-class adjustment");
    expect(expanded).toContain("version 3");
  });

  it("has no editable control for core identity and routes axis edits through the proposal callback", () => {
    const onPropose = vi.fn();
    const html = renderToStaticMarkup(<PersonaPanel model={model} expanded onPropose={onPropose} />);
    expect(html).not.toContain('name="mission"');
    expect(html).not.toContain('name="authority"');
    expect(html).not.toContain('name="truthfulness"');
    expect(html).toContain('data-editable-axis="caution"');
    expect(onPropose).not.toHaveBeenCalled();
  });

  it("shows stale decision invalidation and binds rollback to durable rollout evidence", () => {
    const html = renderToStaticMarkup(<PersonaPanel model={model} expanded />);
    expect(html).toContain("pending decision invalidated by version 2");
    expect(html).toContain("prior-1");
    expect(html).toContain("event-1");
    expect(html).toContain("automatic_rollback");
  });

  it("shows a real server rejection instead of hiding an authority edit attempt", () => {
    const html = renderToStaticMarkup(<PersonaPanel model={model} expanded error="authority changes are rejected by the control plane" />);
    expect(html).toContain("authority changes are rejected by the control plane");
    expect(html).toContain("rejected");
  });
});
