# Device Agent App

Process entry point for the device-agent protocol. It exposes the narrow device session and capability channel used by Maestro; it does not own Goal authority or provider credentials.

## Run

```sh
npm run build
node apps/device-agent/dist/main.js
```

Configure the process with one JSON environment variable. All fields below are required except `maxReadBytes`:

```sh
export MAESTRO_DEVICE_AGENT_CONFIG='{
  "databaseUrl":"postgresql://...",
  "host":"127.0.0.1",
  "port":0,
  "deviceId":"<enrolled-device-id>",
  "identityFingerprint":"<certificate-fingerprint>",
  "issuerKeyId":"<issuer-key-id>",
  "issuerPublicKey":"<base64-ed25519-public-key>",
  "keyPath":"/secure/device-key.pem",
  "certPath":"/secure/device-cert.pem",
  "caPath":"/secure/issuer-ca.pem",
  "statePath":"/secure/device-fence-state.json",
  "projectRoot":"/tmp/maestro-project",
  "maxReadBytes":1048576
}'
node apps/device-agent/dist/main.js
```

The database must contain an enrolled device whose ID and certificate fingerprint match the JSON. The process reads only below `projectRoot`, uses mutual TLS, verifies signed Goal/grant/fencing envelopes, and never receives provider credentials. Commands are sequence-checked and grant-scoped.

## Tests

```sh
npm test -- apps/device-agent/src/main.integration.test.ts packages/device-agent/src/device-agent.test.ts
```

