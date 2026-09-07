# Anthropic Provider

Model-provider adapter for the authenticated Anthropic API boundary. It exposes normalized turns and cancellation to the Model Gateway.

Provider secrets are resolved by the gateway credential store, not this package.

```sh
npm test -- packages/model-provider-anthropic/src
```

