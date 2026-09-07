# CLI

Terminal client for the authenticated Maestro Control Plane. It is a presentation and operator-command surface, not an execution runtime and not a credential store.

## Run

```sh
npm run build
node apps/cli/dist/main.js --help
```

Configure the Control Plane URL and operator token through the documented local connection flow. Provider credentials stay in the Model Gateway.

## Tests

```sh
npm test -- apps/cli/src/main.test.ts apps/cli/src/tui
```

