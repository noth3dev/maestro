export interface ActiveEventStream {
  sender: object;
  controller: AbortController;
  removeLifecycleListener: () => void;
}

export function abortEventStreamsForSender(activeStreams: Map<string, ActiveEventStream>, sender: object): void {
  for (const [streamId, active] of activeStreams) {
    if (active.sender !== sender) continue;
    active.controller.abort();
    active.removeLifecycleListener();
    activeStreams.delete(streamId);
  }
}

export function abortAllEventStreams(activeStreams: Map<string, ActiveEventStream>): void {
  for (const active of activeStreams.values()) {
    active.controller.abort();
    active.removeLifecycleListener();
  }
  activeStreams.clear();
}
