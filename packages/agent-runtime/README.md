# Agent Runtime

Provider-neutral native runtime. It validates host-owned admissions, applies capability/model/budget limits, routes turns through a gateway binding, normalizes observations, and handles cancellation/release.

The runtime never receives raw provider credentials. Register only explicitly approved host tools in `ToolRegistry`.

```sh
npm test -- packages/agent-runtime/src
```

