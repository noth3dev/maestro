export interface ConversationTurnBoundary {
  capture: () => number;
  invalidate: () => void;
  isCurrent: (generation: number) => boolean;
}

export interface TranscriptClearBoundary extends ConversationTurnBoundary {
  clear: () => void;
}

export function createConversationTurnBoundary(): ConversationTurnBoundary {
  let generation = 0;
  return {
    capture: () => generation,
    invalidate: () => {
      generation += 1;
    },
    isCurrent: (candidate) => candidate === generation,
  };
}

export function createTranscriptClearBoundary(): TranscriptClearBoundary {
  const boundary = createConversationTurnBoundary();
  return { ...boundary, clear: boundary.invalidate };
}
