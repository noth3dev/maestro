import { randomUUID } from "node:crypto";
import { isCurrentConversationTurnController, noModelSelectionMessage } from "../../../entry-helpers.js";
import { resolveConfiguredModel } from "../../../entry-hydration.js";
import { selectedConversationGoalId } from "../../../dashboard-state.js";
import { buildConversationInput } from "../../../goal-less-intake.js";
import { saveWorkspaceSession } from "../../../session.js";
import { addConversationMessage, applyConversationEvent } from "../../../conversation-transcript.js";
import { createConversationActivityReadiness } from "../../../conversation-activity.js";
import { compactConversationAcknowledgement } from "../../../entry-helpers.js";
import type { ConversationEvent } from "@maestro/contracts";
import type { TuiController } from "../../controller.js";

export async function handleNaturalLanguageTurn(c: TuiController, text: string, outcome: { turnGeneration?: number }): Promise<boolean> {
  const project = c.project;
  // Reads the live project after each await: a /session attach racing the
  // turn must not send provider calls to a stale project.
  const attachedProject = (): { projectId: string } => {
    const current = c.project;
    if (current.kind !== "attached") throw new Error("Workspace project detached during turn");
    return current;
  };
  if (c.client === undefined) {
    c.view.append(
      `Concertmaster unavailable: ${c.state.connection.kind === "error" ? c.state.connection.message : "Control Plane client unavailable"}`,
    );
    return false;
  } else if (project.kind !== "attached") {
    c.view.appendWarning("Concertmaster requires an attached workspace project.");
    return false;
  } else if (c.flashmobMode) {
    c.view.append(
      "Flashmob is a planned bounded fast path, but its Vanguard runtime is not wired yet. Switch to /mode maestro for governed conversation.",
    );
    return false;
  } else {
    // Snapshot reads below are all pre-await, hence identical to live reads.
    const session = c.session;
    if (session === undefined) {
      c.view.appendError("Concertmaster requires an attached workspace session.");
      return true;
    }
    const configuredModel = resolveConfiguredModel(c.options.env.MAESTRO_MODEL, session.model);
    if (session.conversationId === undefined && configuredModel === undefined) {
      c.view.appendWarning(noModelSelectionMessage());
    } else {
      const turnGeneration = c.conversationTurnBoundary.capture();
      outcome.turnGeneration = turnGeneration;
      if (session.conversationId === undefined) {
        const conversationGoalId = selectedConversationGoalId(c.state.goal, session.goalId);
        const requestedProjectId = project.projectId;
        const created = await c.client.createConversation(
          buildConversationInput(requestedProjectId, conversationGoalId, configuredModel!),
          {
            idempotencyKey: randomUUID(),
          },
        );
        if (!c.conversationTurnBoundary.isCurrent(turnGeneration)) {
          c.editor.addToHistory(text);
          return true;
        }
        const boundProject = attachedProject();
        if (boundProject.projectId !== requestedProjectId) throw new Error("Workspace project changed during conversation creation");
        c.session = {
          workspacePath: c.sessionWorkspacePath,
          projectId: boundProject.projectId,
          ...(conversationGoalId === undefined ? {} : { goalId: conversationGoalId }),
          ...(c.session?.lastEventCursor === undefined ? {} : { lastEventCursor: c.session.lastEventCursor }),
          conversationId: created.conversationId,
          model: created.model,
        };
        c.state.model = created.model;
        await saveWorkspaceSession(c.session);
        c.view.appendSuccess(`Concertmaster conversation ${created.conversationId} · ${created.model}`);
      }
      const activeConversationId = c.session?.conversationId;
      if (activeConversationId === undefined) throw new Error("Conversation was not created");
      await c.conversationHydration;
      if (!c.conversationTurnBoundary.isCurrent(turnGeneration)) {
        c.editor.addToHistory(text);
        return true;
      }
      c.conversation = addConversationMessage(c.conversation, "user", text);
      c.view.render();
      const turnController = new AbortController();
      c.conversationTurnController = turnController;
      c.state.working = true;
      c.state.workingSince = Date.now();
      c.state.workingTick = 0;
      c.state.conversationActivity = { phase: "thinking" };
      const activityReadiness = createConversationActivityReadiness(turnController.signal);
      const streamController = new AbortController();
      c.conversationStreamController?.abort();
      c.conversationActivityController?.abort();
      c.conversationStreamController = streamController;
      const activityController = new AbortController();
      c.conversationActivityController = activityController;
      const displayGeneration = c.conversationDisplayBoundary.capture();
      void c.activitySync.streamConversation(activeConversationId, attachedProject().projectId, streamController, displayGeneration);
      void c.activitySync.streamConversationActivity(
        activeConversationId,
        attachedProject().projectId,
        activityController,
        displayGeneration,
        activityReadiness.markConnected,
      );
      if (!c.conversationTurnBoundary.isCurrent(turnGeneration) || turnController.signal.aborted) {
        c.editor.addToHistory(text);
        return true;
      }
      await activityReadiness.promise;
      if (!c.conversationTurnBoundary.isCurrent(turnGeneration) || turnController.signal.aborted) {
        c.editor.addToHistory(text);
        return true;
      }
      if (c.workingLoaderTimer !== undefined) clearInterval(c.workingLoaderTimer);
      c.workingLoaderTimer = setInterval(() => {
        if (isCurrentConversationTurnController(turnController, c.conversationTurnController)) {
          c.state.workingTick = (c.state.workingTick ?? 0) + 1;
          c.view.render();
        }
      }, 120);
      c.view.render();
      try {
        const result = await c.client.sendConversationTurn(
          activeConversationId,
          { projectId: attachedProject().projectId, text },
          { signal: turnController.signal, idempotencyKey: randomUUID() },
        );
        const terminalType =
          result.turn.status === "completed"
            ? "turn_completed"
            : result.turn.status === "cancelled"
              ? "turn_cancelled"
              : result.turn.status === "failed"
                ? "turn_failed"
                : "turn_unknown";
        const terminalEvent: ConversationEvent = {
          cursor: result.turn.cursor,
          eventId: result.turn.turnId,
          conversationId: result.turn.conversationId,
          projectId: attachedProject().projectId,
          eventType: terminalType,
          payload: {
            turnId: result.turn.turnId,
            status: result.conversation.status,
            ...(result.turn.status === "completed" ? { content: result.turn.content } : { message: result.turn.content }),
          },
          occurredAt: result.turn.createdAt,
        };
        if (c.conversationTurnBoundary.isCurrent(turnGeneration) && c.conversationDisplayBoundary.isCurrent(displayGeneration)) {
          c.conversation = applyConversationEvent(c.conversation, terminalEvent);
          if (c.terminal.rows < 16) {
            c.compactConversationResult = compactConversationAcknowledgement(c.conversation, c.terminal.columns);
            c.compactCommandResult = undefined;
            c.compactTaskContractReview = false;
          }
          c.view.showDraftIfPresent(result.turn.content);
          c.view.render();
        }
      } finally {
        if (isCurrentConversationTurnController(turnController, c.conversationTurnController)) {
          c.conversationTurnController = undefined;
          c.conversationActivityController?.abort();
          c.conversationActivityController = undefined;
          if (c.workingLoaderTimer !== undefined) {
            clearInterval(c.workingLoaderTimer);
            c.workingLoaderTimer = undefined;
          }
          c.state.working = false;
          delete c.state.workingSince;
          delete c.state.workingTick;
          delete c.state.conversationActivity;
          c.view.render();
        }
      }
    }
    return false;
  }
}
