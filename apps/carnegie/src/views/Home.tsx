import { useEffect, useState } from "react";
import type { OvertureEvent, OvertureMessage, OverturePlanManifest, OvertureRun, TaskContract } from "@maestro/contracts";
import { Icon } from "../icons.js";
import { useConnection } from "../connection.js";
import { useGoals } from "../goals.js";
import type { ViewName } from "../views.js";
import type { HomeMode } from "../homeMode.js";
import {
  canEditTaskContract,
  ConversationTurnError,
  confirmTaskContractDraft,
  formatTaskContractReview,
  getTaskContractPhase,
  launchTaskContractDraft,
  submitHomeBrief,
  updateTaskContractDraft,
} from "../lib/task-contract-authoring.js";
import { loadConversation, type ConversationMessage } from "../lib/conversation-data.js";

const overtureRoles = [
  "conversation-lead",
  "architecture-analyst",
  "external-research-scout",
  "security-evaluator",
  "design-mock-specialist",
  "task-editor",
] as const;

const homeTitles = [
  "what should the floor work on",
  "give the floor a brief",
  "what needs the orchestra today",
  "what should the concertmaster take on",
];

type DraftForm = {
  desiredOutcome: string;
  successCriteria: string;
  repository: string;
  immutableBaseRevision: string;
  dataBoundary: string;
};

type OvertureContractForm = {
  desiredOutcome: string;
  successCriteria: string;
  repository: string;
  immutableBaseRevision: string;
  dataBoundary: string;
  expectedGroups: string;
  expectedDepartments: string;
};

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function formFromContract(contract: TaskContract): DraftForm {
  return {
    desiredOutcome: contract.desiredOutcome,
    successCriteria: contract.successCriteria.join("\n"),
    repository: contract.project.repository,
    immutableBaseRevision: contract.project.immutableBaseRevision,
    dataBoundary: contract.project.dataBoundary,
  };
}

export function submitHomeComposer(mode: HomeMode, event: Pick<React.FormEvent, "preventDefault">, submit: () => void): void {
  event.preventDefault();
  if (mode === "flashmob") return;
  submit();
}

export function Home({
  onNavigate,
  mode,
  onModeChange,
}: {
  onNavigate: (view: ViewName) => void;
  mode: HomeMode;
  onModeChange: (mode: HomeMode) => void;
}) {
  const { config } = useConnection();
  const { selectedGoalId } = useGoals();
  const [title] = useState(() => homeTitles[Math.floor(Math.random() * homeTitles.length)]);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<TaskContract | undefined>(undefined);
  const [draftOrigin, setDraftOrigin] = useState<"goal-less" | "goal-attached" | undefined>(undefined);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [conversationProjectId, setConversationProjectId] = useState<string | undefined>(undefined);
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [turnStatus, setTurnStatus] = useState<"idle" | "loading" | "completed" | "failed" | "cancelled" | "unknown">("idle");
  const [intakeMessage, setIntakeMessage] = useState<string | undefined>(undefined);
  const [draftForm, setDraftForm] = useState<DraftForm | undefined>(undefined);
  const [confirmed, setConfirmed] = useState(false);
  const [draftRejected, setDraftRejected] = useState(false);
  const [overtureRun, setOvertureRun] = useState<OvertureRun | undefined>(undefined);
  const [overtureMessages, setOvertureMessages] = useState<readonly OvertureMessage[]>([]);
  const [overtureManifest, setOvertureManifest] = useState<OverturePlanManifest | undefined>(undefined);
  const [overturePlanContent, setOverturePlanContent] = useState("");
  const [overtureContractForm, setOvertureContractForm] = useState<OvertureContractForm>({
    desiredOutcome: "",
    successCriteria: "",
    repository: "",
    immutableBaseRevision: "",
    dataBoundary: "",
    expectedGroups: "",
    expectedDepartments: "",
  });
  const [overtureError, setOvertureError] = useState<string | undefined>(undefined);
  const [overtureBusy, setOvertureBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const isFlashmob = mode === "flashmob";
  const dirty = draft !== undefined && draftForm !== undefined && JSON.stringify(draftForm) !== JSON.stringify(formFromContract(draft));
  const draftPhase = draft === undefined ? undefined : getTaskContractPhase(draft, confirmed, draftRejected);
  const projectId = config?.projectId;
  const showConversationState = conversationId !== undefined || conversationMessages.length > 0 || turnStatus !== "idle";

  useEffect(() => {
    if (projectId === undefined) return;
    setConversationId(undefined);
    setConversationProjectId(projectId);
    setConversationMessages([]);
    setTurnStatus("idle");
    setDraft(undefined);
    setDraftForm(undefined);
    setDraftOrigin(undefined);
    setConfirmed(false);
    setDraftRejected(false);
    setOvertureRun(undefined);
    setOvertureMessages([]);
    setOvertureManifest(undefined);
    setOverturePlanContent("");
    setOvertureContractForm({
      desiredOutcome: "",
      successCriteria: "",
      repository: "",
      immutableBaseRevision: "",
      dataBoundary: "",
      expectedGroups: "",
      expectedDepartments: "",
    });
    setOvertureError(undefined);
    setError(undefined);
  }, [projectId]);

  useEffect(() => {
    if (projectId === undefined || conversationId === undefined || conversationProjectId !== projectId) return;
    let current = true;
    void loadConversation(window.maestro.api, { conversationId, projectId })
      .then((messages) => {
        if (current) setConversationMessages(messages);
      })
      .catch((cause) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      current = false;
    };
  }, [conversationId, conversationProjectId, projectId]);

  const awakenOverture = async (input: { conversationId: string; turnId: string; content: string }) => {
    if (config === undefined) return;
    setOverturePlanContent((current) => (current === "" ? `# Project plan\n\n## Operator request\n\n${input.content}` : current));
    setOvertureBusy(true);
    setOvertureError(undefined);
    try {
      const runId = globalThis.crypto.randomUUID();
      const run = await window.maestro.api.createOvertureRun(
        { runId, projectId: config.projectId, conversationId: input.conversationId, roles: overtureRoles },
        { idempotencyKey: globalThis.crypto.randomUUID() },
      );
      setOvertureRun(run);
      await window.maestro.api.sendOvertureOperatorMessage(
        runId,
        { projectId: config.projectId, conversationId: input.conversationId, turnId: input.turnId, content: input.content },
        { idempotencyKey: globalThis.crypto.randomUUID() },
      );
      const [messages, updatedRun] = await Promise.all([
        window.maestro.api.listOvertureMessages(runId, {
          projectId: config.projectId,
          conversationId: input.conversationId,
          afterCursor: "0",
        }),
        window.maestro.api.getOvertureRun(runId, { projectId: config.projectId, conversationId: input.conversationId }),
      ]);
      setOvertureMessages(messages);
      setOvertureRun(updatedRun);
      if (updatedRun.planManifestHash !== null) {
        const manifest = await window.maestro.api.getOverturePlanManifest(runId, {
          projectId: config.projectId,
          conversationId: input.conversationId,
        });
        setOvertureManifest(manifest);
      }
    } catch (cause) {
      setOvertureError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOvertureBusy(false);
    }
  };

  useEffect(() => {
    if (config === undefined || overtureRun === undefined) return;
    const refresh = async () => {
      try {
        const [events, messages, updatedRun] = await Promise.all([
          window.maestro.api.listOvertureEvents(overtureRun.runId, {
            projectId: config.projectId,
            conversationId: overtureRun.conversationId,
            afterCursor: "0",
          }),
          window.maestro.api.listOvertureMessages(overtureRun.runId, {
            projectId: config.projectId,
            conversationId: overtureRun.conversationId,
            afterCursor: "0",
          }),
          window.maestro.api.getOvertureRun(overtureRun.runId, { projectId: config.projectId, conversationId: overtureRun.conversationId }),
        ]);
        setOvertureMessages(messages);
        setOvertureRun(updatedRun);
        const hasPlan =
          updatedRun.planManifestHash !== null || events.some((event: OvertureEvent) => event.eventType === "manifest_revision_created");
        if (hasPlan) {
          const manifest = await window.maestro.api.getOverturePlanManifest(overtureRun.runId, {
            projectId: config.projectId,
            conversationId: overtureRun.conversationId,
          });
          setOvertureManifest(manifest);
        }
      } catch (cause) {
        setOvertureError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    const timer = window.setInterval(() => {
      void refresh();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [config, overtureRun?.conversationId, overtureRun?.runId]);

  useEffect(() => {
    if (overtureManifest === undefined) return;
    const root = overtureManifest.documents.find((document) => document.path === "plan00.md");
    if (root === undefined) return;
    setOvertureContractForm((current) => ({
      ...current,
      desiredOutcome:
        current.desiredOutcome === ""
          ? `Implement the reviewed plan set starting with ${root.path} at version ${root.version}`
          : current.desiredOutcome,
      successCriteria:
        current.successCriteria === ""
          ? overtureManifest.documents.map((document) => `${document.path} is reviewed at version ${document.version}`).join("\n")
          : current.successCriteria,
    }));
  }, [overtureManifest]);

  const createOverturePlan = async () => {
    if (config === undefined || overtureRun === undefined || overturePlanContent.trim() === "") {
      setOvertureError("Write the project blueprint before creating plan00.md.");
      return;
    }
    setOvertureBusy(true);
    setOvertureError(undefined);
    try {
      const content = overturePlanContent.trim();
      const documentId = globalThis.crypto.randomUUID();
      await window.maestro.api.reviseOverturePlan(
        overtureRun.runId,
        documentId,
        {
          projectId: config.projectId,
          conversationId: overtureRun.conversationId,
          path: "plan00.md",
          kind: "project",
          content,
          contentHash: await sha256(content),
          sourceRefs: [],
          dependencies: [],
          expectedVersion: 0,
        },
        { idempotencyKey: globalThis.crypto.randomUUID() },
      );
      const manifest = await window.maestro.api.getOverturePlanManifest(overtureRun.runId, {
        projectId: config.projectId,
        conversationId: overtureRun.conversationId,
      });
      setOvertureManifest(manifest);
      setOvertureRun(
        await window.maestro.api.getOvertureRun(overtureRun.runId, {
          projectId: config.projectId,
          conversationId: overtureRun.conversationId,
        }),
      );
    } catch (cause) {
      setOvertureError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOvertureBusy(false);
    }
  };

  const createOvertureContract = async () => {
    if (config === undefined || overtureRun === undefined || overtureManifest === undefined) return;
    const root = overtureManifest.documents.find((document) => document.path === "plan00.md");
    if (root === undefined) return;
    const required = [
      overtureContractForm.desiredOutcome,
      overtureContractForm.successCriteria,
      overtureContractForm.repository,
      overtureContractForm.immutableBaseRevision,
      overtureContractForm.dataBoundary,
      overtureContractForm.expectedGroups,
      overtureContractForm.expectedDepartments,
    ];
    if (required.some((value) => value.trim() === "")) {
      setOvertureError("Complete the Task Contract boundary fields before creating the awaiting contract.");
      return;
    }
    setOvertureBusy(true);
    setOvertureError(undefined);
    try {
      const planEvidence = overtureManifest.documents.map((document) => `${document.path}@v${document.version}#${document.contentHash}`);
      const contract = await window.maestro.api.createOvertureTaskContract(
        overtureRun.runId,
        {
          projectId: config.projectId,
          conversationId: overtureRun.conversationId,
          planId: root.documentId,
          planVersion: root.version,
          manifestHash: overtureManifest.manifestHash,
          substance: {
            desiredOutcome: overtureContractForm.desiredOutcome.trim(),
            userVisibleBehavior: ["The reviewed Overture plan is visible before confirmation"],
            successCriteria: lines(overtureContractForm.successCriteria),
            liveEvidence: [`Overture manifest ${overtureManifest.manifestHash}`, ...planEvidence],
            scope: [`Project ${config.projectId}`, `Plan manifest ${overtureManifest.manifestHash}`],
            nonGoals: ["Execution before explicit confirmation and launch"],
            priorities: ["Preserve exact plan hashes", "Keep all effects behind the existing authority path"],
            acceptableTradeoffs: ["Remain blocked when provider or plan evidence is unavailable"],
            constraints: ["The Task Contract references the reviewed Overture plan set"],
            knownEdgeCases: ["Stale plan manifest", "Provider unavailable", "Concurrent revision"],
            project: {
              projectId: config.projectId,
              repository: overtureContractForm.repository.trim(),
              immutableBaseRevision: overtureContractForm.immutableBaseRevision.trim(),
              dataBoundary: overtureContractForm.dataBoundary.trim(),
            },
            evidenceReferences: planEvidence,
            approvedPreviewReferences: overtureManifest.documents.map((document) => document.path),
            expectedGroups: lines(overtureContractForm.expectedGroups),
            expectedDepartments: lines(overtureContractForm.expectedDepartments),
            criticalActionExpectations: ["Show the exact effect and require explicit approval"],
            forbiddenEffects: ["Unapproved external effects", "Self-approval"],
            environmentAssumptions: ["PostgreSQL-backed Overture state", "Control Plane remains authoritative"],
            externalServiceAssumptions: ["No external effect before launch"],
            budget: {
              ceiling: "Server-defined",
              reportingExpectations: ["Report durable state and evidence"],
              stoppingConditions: ["Stop on stale hashes, authority failure, or provider uncertainty"],
            },
          },
        },
        { idempotencyKey: globalThis.crypto.randomUUID() },
      );
      setDraft(contract);
      setDraftOrigin("goal-less");
      setDraftForm(formFromContract(contract));
      setConfirmed(false);
      setDraftRejected(false);
    } catch (cause) {
      setOvertureError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOvertureBusy(false);
    }
  };

  const submitBrief = async (event: React.FormEvent) => {
    event.preventDefault();
    if (config === undefined) return;
    const submittedText = text.trim();
    setBusy(true);
    setTurnStatus("loading");
    setError(undefined);
    try {
      const intake = await submitHomeBrief(window.maestro.api, {
        projectId: config.projectId,
        text: submittedText,
        selectedGoalId,
        ...(conversationId === undefined ? {} : { conversationId }),
        onConversationCreated: (createdConversationId) => {
          setConversationId(createdConversationId);
          setConversationProjectId(config.projectId);
        },
      });
      let completedTurn = false;
      if ("conversationId" in intake && intake.conversationId !== undefined) {
        setConversationId(intake.conversationId);
        setConversationProjectId(config.projectId);
        const createdAt = new Date().toISOString();
        setConversationMessages((messages) => [
          ...messages,
          { id: `operator-${intake.conversationId}-${createdAt}`, role: "operator", content: submittedText, createdAt },
          { id: `assistant-${intake.conversationId}-${createdAt}`, role: "concertmaster", content: intake.response, createdAt },
        ]);
        completedTurn = intake.turnStatus === "completed";
        setTurnStatus(completedTurn ? "completed" : intake.turnStatus === "accepted" ? "loading" : intake.turnStatus);
        if (completedTurn) await awakenOverture({ conversationId: intake.conversationId, turnId: intake.turnId, content: submittedText });
      } else {
        setTurnStatus("idle");
      }
      if ("message" in intake) setIntakeMessage(intake.message);
      else setIntakeMessage(undefined);
      if (intake.draft !== undefined) {
        setDraft(intake.draft);
        setDraftOrigin(selectedGoalId === undefined ? "goal-less" : "goal-attached");
        setDraftForm(formFromContract(intake.draft));
        setConfirmed(false);
        setDraftRejected(false);
      }
      setText("conversationId" in intake && !completedTurn ? submittedText : "");
    } catch (cause) {
      if (cause instanceof ConversationTurnError) {
        setConversationId(cause.conversationId);
        setConversationProjectId(config.projectId);
      }
      setTurnStatus("failed");
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const retryBrief = () => {
    if (!(turnStatus === "failed" || turnStatus === "cancelled" || turnStatus === "unknown") || text.trim() === "") return;
    void submitBrief({ preventDefault: () => undefined } as React.FormEvent);
  };

  const cancelTurn = async () => {
    if (config === undefined || conversationId === undefined || conversationProjectId !== config.projectId || turnStatus !== "loading")
      return;
    setCancelBusy(true);
    setError(undefined);
    try {
      await window.maestro.api.cancelConversation(conversationId, { projectId: config.projectId });
      setTurnStatus("cancelled");
    } catch (cause) {
      setTurnStatus("failed");
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCancelBusy(false);
    }
  };

  const saveDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    if (draft === undefined || draftForm === undefined || draftPhase === undefined || !canEditTaskContract(draftPhase)) return;
    setBusy(true);
    setError(undefined);
    try {
      const updated = await updateTaskContractDraft(window.maestro.api, draft, {
        desiredOutcome: draftForm.desiredOutcome,
        successCriteria: lines(draftForm.successCriteria),
        project: {
          repository: draftForm.repository,
          immutableBaseRevision: draftForm.immutableBaseRevision,
          dataBoundary: draftForm.dataBoundary,
        },
      });
      setDraft(updated);
      setDraftForm(formFromContract(updated));
      setDraftRejected(false);
    } catch (cause) {
      setDraftRejected(true);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirmDraft = async () => {
    if (draft === undefined || dirty || confirmed) return;
    setBusy(true);
    setError(undefined);
    try {
      await confirmTaskContractDraft(window.maestro.api, draft);
      setConfirmed(true);
      setDraftRejected(false);
    } catch (cause) {
      setDraftRejected(true);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const launchDraft = async () => {
    if (draft === undefined || !confirmed) return;
    setBusy(true);
    setError(undefined);
    try {
      setDraft(await launchTaskContractDraft(window.maestro.api, draft));
      setDraftRejected(false);
    } catch (cause) {
      setDraftRejected(true);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const submitComposer = (event: React.FormEvent) => {
    submitHomeComposer(mode, event, () => {
      void submitBrief(event);
    });
  };

  return (
    <div className="home-main">
      <div className="home-title">{title}</div>
      {showConversationState && (
        <section
          className="home-conversation"
          aria-label="Concertmaster conversation"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
        >
          <div>conversation {conversationId ?? "not started"}</div>
          <div role="status" aria-live="polite" aria-atomic="true">
            turn {turnStatus}
          </div>
          {conversationMessages.map((message) => (
            <p key={message.id} data-role={message.role}>
              {message.content}
            </p>
          ))}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={conversationId === undefined}
            onClick={() => document.getElementById("home-brief")?.focus()}
          >
            continue conversation
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={
              !(["failed", "cancelled", "unknown"] as const).includes(turnStatus as "failed" | "cancelled" | "unknown") ||
              busy ||
              text.trim() === ""
            }
            onClick={retryBrief}
          >
            retry turn
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={conversationId === undefined || turnStatus !== "loading" || cancelBusy}
            onClick={() => void cancelTurn()}
          >
            {cancelBusy ? "cancelling…" : "cancel turn"}
          </button>
        </section>
      )}
      <form className={`home-composer${isFlashmob ? " mode-flashmob" : ""}`} onSubmit={submitComposer}>
        <label className="sr-only" htmlFor="home-brief">
          Brief the Concertmaster
        </label>
        <textarea
          id="home-brief"
          placeholder={isFlashmob ? "Flashmob is deferred until its durable backend contract exists." : "brief the concertmaster"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={isFlashmob || busy}
          aria-describedby={isFlashmob ? "home-flashmob-hint" : undefined}
        />
        <div className="home-composer-row">
          <div className="pill-toggle" role="group" aria-label="Home mode">
            <button
              type="button"
              className={mode === "maestro" ? "on" : ""}
              aria-pressed={mode === "maestro"}
              onClick={() => onModeChange("maestro")}
            >
              maestro
            </button>
            <button
              type="button"
              className={isFlashmob ? "on flashmob" : ""}
              aria-pressed={isFlashmob}
              onClick={() => onModeChange("flashmob")}
            >
              flashmob
            </button>
          </div>
          <button
            className={`btn btn-primary btn-sm home-send-btn${isFlashmob ? " mode-flashmob" : ""}`}
            style={{ marginLeft: "auto" }}
            disabled={isFlashmob || busy || text.trim() === ""}
            type="submit"
          >
            {busy && draft === undefined ? "saving…" : "send"} <Icon name="send" style={{ width: 12, height: 12 }} />
          </button>
        </div>
      </form>

      {error !== undefined && (
        <div className="alert alert-warning home-authoring-error" role="alert">
          {error}
        </div>
      )}
      {intakeMessage !== undefined && draft === undefined && (
        <div className="alert alert-warning home-authoring-message" role="status">
          {intakeMessage}
        </div>
      )}

      {overtureRun !== undefined && (
        <section className="home-draft home-overture" aria-labelledby="home-overture-title">
          <div className="home-draft-head">
            <div>
              <h2 id="home-overture-title">Overture Crew</h2>
              <p>
                {overtureRun.runId} · {overtureRun.state} · v{overtureRun.version}
              </p>
            </div>
            <span className={`badge ${overtureRun.state === "blocked" ? "badge-rust" : "badge-slate"}`}>{overtureRun.state}</span>
          </div>
          <p className="form-hint">
            Same conversation · {overtureRun.roles.length} roles · no Goal or Worker is created before exact launch.
          </p>
          {overtureBusy && (
            <p role="status" aria-live="polite">
              awakening the Crew…
            </p>
          )}
          {overtureError !== undefined && (
            <div className="alert alert-warning" role="alert">
              {overtureError}
            </div>
          )}
          <div className="home-overture-roles" aria-label="Overture roles">
            {overtureRun.roles.map((role) => (
              <span className="badge badge-slate" key={role.roleId}>
                {role.roleId} · {role.status}
              </span>
            ))}
          </div>
          {overtureMessages.length > 0 && (
            <div className="home-conversation" aria-label="Overture messages">
              {overtureMessages.map((message) => (
                <p key={message.messageId}>
                  <strong>{message.actor}</strong>: {message.content}
                </p>
              ))}
            </div>
          )}
          {overtureManifest === undefined && (
            <form
              className="home-overture-editor"
              onSubmit={(event) => {
                event.preventDefault();
                void createOverturePlan();
              }}
            >
              <p className="form-hint">
                Task Editor · start the versioned project blueprint. The server will hash and persist this plan before any Task Contract
                exists.
              </p>
              <div className="form-field">
                <label className="form-label" htmlFor="overture-plan00">
                  plan00.md
                </label>
                <textarea
                  id="overture-plan00"
                  className="input textarea"
                  value={overturePlanContent}
                  onChange={(event) => setOverturePlanContent(event.target.value)}
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={overtureBusy || overturePlanContent.trim() === ""}>
                save plan00.md
              </button>
            </form>
          )}
          {overtureManifest !== undefined && (
            <details open>
              <summary>Plan set · {overtureManifest.manifestHash}</summary>
              <ul>
                {overtureManifest.documents.map((document) => (
                  <li key={document.documentId}>
                    {document.path} · v{document.version} · {document.contentHash}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {overtureManifest !== undefined && draft === undefined && (
            <form
              className="home-overture-editor"
              onSubmit={(event) => {
                event.preventDefault();
                void createOvertureContract();
              }}
            >
              <p className="form-hint">
                Task Editor handoff. These fields are required because the server will not invent repository or organization boundaries.
              </p>
              {(
                [
                  ["overture-outcome", "Desired outcome", "desiredOutcome"],
                  ["overture-success", "Success criteria (one per line)", "successCriteria"],
                  ["overture-repository", "Repository", "repository"],
                  ["overture-base", "Immutable base revision", "immutableBaseRevision"],
                  ["overture-boundary", "Data boundary", "dataBoundary"],
                  ["overture-groups", "Expected groups (one per line)", "expectedGroups"],
                  ["overture-departments", "Expected departments (one per line)", "expectedDepartments"],
                ] as const
              ).map(([id, label, field]) => (
                <div className="form-field" key={id}>
                  <label className="form-label" htmlFor={id}>
                    {label}
                  </label>
                  <textarea
                    id={id}
                    className="input textarea"
                    value={overtureContractForm[field]}
                    onChange={(event) => setOvertureContractForm({ ...overtureContractForm, [field]: event.target.value })}
                  />
                </div>
              ))}
              <button className="btn btn-primary" type="submit" disabled={overtureBusy}>
                create awaiting Task Contract
              </button>
            </form>
          )}
        </section>
      )}

      {draft !== undefined && draftForm !== undefined && (
        <section className="home-draft" aria-labelledby="home-draft-title">
          <div className="home-draft-head">
            <div>
              <h2 id="home-draft-title">Task Contract draft</h2>
              <p>
                {draft.contractId} · v{draft.version} · {draft.launchState}
                {confirmed ? " · confirmation accepted" : ""}
              </p>
            </div>
            {draftPhase === "draft" && <span className="badge badge-ochre">draft</span>}
            {draftPhase === "confirmed" && <span className="badge badge-slate">confirmed</span>}
            {draftPhase === "launched" && <span className="badge badge-olive">launched</span>}
            {draftPhase === "rejected" && <span className="badge badge-rust">rejected</span>}
            {draftOrigin === "goal-less" && draft.launchState === "awaiting_confirmation" && (
              <span className="badge badge-slate">Single Launch Confirmation required</span>
            )}
          </div>
          <p className="form-hint" data-contract-phase={draftPhase}>
            phase: {draftPhase}
          </p>
          <details className="home-draft-review" open>
            <summary>Full Task Contract review</summary>
            <pre aria-label="Full Task Contract draft">{formatTaskContractReview(draft)}</pre>
          </details>
          <form onSubmit={(event) => void saveDraft(event)}>
            <div className="form-field">
              <label className="form-label" htmlFor="draft-outcome">
                Desired outcome
              </label>
              <textarea
                id="draft-outcome"
                className="input textarea"
                value={draftForm.desiredOutcome}
                disabled={confirmed || busy}
                onChange={(event) => setDraftForm({ ...draftForm, desiredOutcome: event.target.value })}
              />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="draft-success">
                Success criteria (one per line)
              </label>
              <textarea
                id="draft-success"
                className="input textarea"
                value={draftForm.successCriteria}
                disabled={confirmed || busy}
                onChange={(event) => setDraftForm({ ...draftForm, successCriteria: event.target.value })}
              />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="draft-repository">
                Repository
              </label>
              <input
                id="draft-repository"
                className="input"
                value={draftForm.repository}
                disabled={confirmed || busy}
                onChange={(event) => setDraftForm({ ...draftForm, repository: event.target.value })}
              />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="draft-base-revision">
                Immutable base revision
              </label>
              <input
                id="draft-base-revision"
                className="input"
                value={draftForm.immutableBaseRevision}
                disabled={confirmed || busy}
                onChange={(event) => setDraftForm({ ...draftForm, immutableBaseRevision: event.target.value })}
              />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="draft-boundary">
                Data boundary
              </label>
              <input
                id="draft-boundary"
                className="input"
                value={draftForm.dataBoundary}
                disabled={confirmed || busy}
                onChange={(event) => setDraftForm({ ...draftForm, dataBoundary: event.target.value })}
              />
            </div>
            <div className="home-draft-actions">
              <button className="btn" type="submit" disabled={busy || confirmed || !dirty}>
                save draft
              </button>
              <button className="btn btn-primary" type="button" disabled={busy || confirmed || dirty} onClick={() => void confirmDraft()}>
                {draftOrigin === "goal-less" ? "single launch confirmation" : "confirm exact draft"}
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy || !confirmed || draft.launchState === "launched"}
                onClick={() => void launchDraft()}
              >
                launch
              </button>
            </div>
          </form>
          <p className="form-hint">
            {draftOrigin === "goal-less"
              ? "Single Launch Confirmation records the exact server version and content hash. It never launches execution; launch is a separate explicit action."
              : "Confirmation only records the exact server version and content hash. Launch is a separate action."}
          </p>
        </section>
      )}

      {!isFlashmob && draft === undefined && (
        <div className="home-cards">
          <button type="button" className="home-card" onClick={() => onNavigate("floor")}>
            <Icon name="chart-pie" aria-hidden="true" />
            <span className="home-card-title">open floor view</span>
            <span className="home-card-sub">see the whole org work</span>
          </button>
          <button type="button" className="home-card" onClick={() => onNavigate("inbox")}>
            <Icon name="inbox" aria-hidden="true" />
            <span className="home-card-title">inbox</span>
            <span className="home-card-sub">certifications for the selected Goal</span>
          </button>
        </div>
      )}

      {isFlashmob && draft === undefined && (
        <section className="home-deferred-state" id="home-flashmob-hint" aria-label="Flashmob deferred state">
          <span className="badge badge-slate">out-of-scope</span>
          <h2>Flashmob is deferred</h2>
          <p>This mode cannot create a session, Worker, Goal, or progress locally. Use maestro for the live Concertmaster path.</p>
          <p className="form-hint">Flashmob can re-enter after Act 1 certification and a durable Act 2 backend contract.</p>
        </section>
      )}
    </div>
  );
}
