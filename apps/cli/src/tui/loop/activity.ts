import { hydrateActivityHistory } from "../activity-history-hydration.js";
import { runLiveActivityStream } from "../activity-live-stream.js";
import { subscribeToEvents } from "../activity-stream.js";
import { loadConversationHistory } from "../conversation-history.js";
import { activityView, runConversationActivityStream } from "../conversation-activity.js";
import { saveWorkspaceSession } from "../session.js";
import type { ConversationActivityEvent } from "@maestro/contracts";
import { applyHydratedConversation, handleConversationStreamEvent } from "../entry-hydration.js";
import { compactConversationAcknowledgement } from "../entry-helpers.js";
import type { TuiController } from "./controller.js";

export class ActivitySync {
  constructor(private c: TuiController) {}

  hydrateActivity = async (
    projectId: string,
    generation: number,
    historyGeneration = this.c.activityHistoryBoundary.capture(),
  ): Promise<void> => {
    const c = this.c;
    if (c.client === undefined) return;
    await hydrateActivityHistory({
      client: c.client,
      projectId,
      readActivity: () => c.activity,
      setActivity: (nextActivity) => {
        c.activity = nextActivity;
      },
      isCurrent: () =>
        generation === c.activityHydrationGeneration &&
        c.activityHistoryBoundary.isCurrent(historyGeneration) &&
        c.project.kind === "attached" &&
        c.project.projectId === projectId,
      onWarning: (message) => c.view.appendWarning(message),
      render: c.view.render,
    });
  };

  streamActivity = async (signal: AbortSignal, projectId: string, generation: number): Promise<void> => {
    const c = this.c;
    if (c.client === undefined) return;
    await runLiveActivityStream({
      client: c.client,
      projectId,
      signal,
      readState: () => ({ activity: c.activity, session: c.session }),
      workspacePath: c.sessionWorkspacePath,
      isCurrent: () => generation === c.activityHydrationGeneration && c.project.kind === "attached" && c.project.projectId === projectId,
      dismissSplash: () => c.splash.dismiss(),
      setActivity: (nextActivity) => {
        c.activity = nextActivity;
      },
      setSession: (nextSession) => {
        c.session = nextSession;
      },
      saveSession: saveWorkspaceSession,
      append: c.view.append,
      render: c.view.render,
    });
  };

  streamConversation = async (
    conversationId: string,
    projectId: string,
    controller: AbortController,
    displayGeneration = this.c.conversationDisplayBoundary.capture(),
  ): Promise<void> => {
    const c = this.c;
    if (c.client === undefined) return;
    const signal = controller.signal;
    try {
      const streamClient = {
        streamEvents: (query: { projectId: string; after: string }, streamOptions: { signal: AbortSignal }) =>
          c.client!.streamConversationEvents(conversationId, query, streamOptions),
      };
      for await (const event of subscribeToEvents({
        client: streamClient,
        projectId,
        cursor: c.conversation.lastCursor,
        signal,
        maxReconnectAttempts: 5,
        onReconnect: (attempt, maxAttempts) =>
          c.view.append({ kind: "warning", text: `Conversation stream reconnecting (${attempt}/${maxAttempts})` }),
      })) {
        if (
          signal.aborted ||
          !c.conversationDisplayBoundary.isCurrent(displayGeneration) ||
          c.session?.conversationId !== conversationId ||
          c.project.kind !== "attached" ||
          c.project.projectId !== projectId
        )
          return;
        const handled = handleConversationStreamEvent({
          conversation: c.conversation,
          event,
          dismissSplash: () => c.splash.dismiss(),
          onCompactOutcome: (nextConversation) => {
            if (c.terminal.rows < 16) {
              c.compactConversationResult = compactConversationAcknowledgement(nextConversation, c.contentWidth());
              c.compactCommandResult = undefined;
              c.compactTaskContractReview = false;
            }
          },
          render: c.view.render,
        });
        c.conversation = handled.conversation;
        if (handled.terminal) {
          if (!signal.aborted) controller.abort();
          return;
        }
      }
      if (!signal.aborted) c.view.appendError("Conversation stream unavailable: reconnect attempts exhausted");
    } catch (error) {
      if (!signal.aborted)
        c.view.appendError(`Conversation stream unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  };

  streamConversationActivity = async (
    conversationId: string,
    projectId: string,
    controller: AbortController,
    displayGeneration = this.c.conversationDisplayBoundary.capture(),
    onConnected?: () => void,
  ): Promise<void> => {
    const c = this.c;
    if (c.client === undefined) return;
    await runConversationActivityStream({
      client: c.client,
      conversationId,
      projectId,
      signal: controller.signal,
      ...(onConnected === undefined ? {} : { onConnected }),
      onEvent: (event: ConversationActivityEvent) => {
        if (
          controller.signal.aborted ||
          !c.conversationDisplayBoundary.isCurrent(displayGeneration) ||
          c.session?.conversationId !== conversationId ||
          c.project.kind !== "attached" ||
          c.project.projectId !== projectId
        )
          return;
        c.state.conversationActivity = activityView(event);
        c.view.render();
      },
      onReset: () => {
        if (!controller.signal.aborted && c.conversationDisplayBoundary.isCurrent(displayGeneration)) {
          delete c.state.conversationActivity;
          c.view.render();
        }
      },
    });
  };

  hydrateConversation = async (conversationId: string | undefined, projectId: string, generation: number): Promise<void> => {
    const c = this.c;
    if (c.client === undefined || conversationId === undefined) return;
    try {
      const hydrated = await loadConversationHistory({
        client: c.client,
        conversationId,
        projectId,
        isCurrent: () =>
          generation === c.conversationHydrationGeneration &&
          c.session?.conversationId === conversationId &&
          c.project.kind === "attached" &&
          c.project.projectId === projectId,
      });
      if (hydrated === undefined) return;
      applyHydratedConversation(hydrated, c.session?.goalId, {
        setConversation: (nextConversation) => {
          c.conversation = nextConversation;
        },
        setDraft: (draft) => {
          c.draftedTaskContract = draft;
        },
        showDraft: c.view.showDraftIfPresent,
      });
      c.splash.dismiss();
      c.view.render();
    } catch (error) {
      if (generation === c.conversationHydrationGeneration)
        c.view.appendError(`Conversation history unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  };

  startActivity = (): void => {
    const c = this.c;
    const project = c.project;
    if (c.activityStarted || c.client === undefined || project.kind !== "attached") return;
    const projectId = project.projectId;
    const generation = c.activityHydrationGeneration;
    c.activityStarted = true;
    c.activityController = new AbortController();
    void this.streamActivity(c.activityController.signal, projectId, generation);
  };

  restartActivity = (): void => {
    const c = this.c;
    c.activityController?.abort();
    c.activityStarted = false;
    c.activityController = undefined;
    c.activity = [];
    c.visibleActivityStart = 0;
    c.state.pendingDecisions = [];
    const generation = ++c.activityHydrationGeneration;
    const project = c.project;
    const projectId = project.kind === "attached" ? project.projectId : undefined;
    if (projectId !== undefined)
      void this.hydrateActivity(projectId, generation).then(() => {
        if (generation === c.activityHydrationGeneration) this.startActivity();
      });
  };
}
