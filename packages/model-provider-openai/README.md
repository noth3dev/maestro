# OpenAI Provider

Model-provider adapter for the OpenAI API and the approved Codex app-server boundary. It normalizes model turns, streaming events, cancellation, and managed-login calls for the Model Gateway.

Provider secrets are resolved by the gateway credential store, not this package.

```sh
npm test -- packages/model-provider-openai/src
```

