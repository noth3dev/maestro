# Plan 8 §S11 CLI release handoff

## Status

The CLI artifact and installer are prepared, but **S11 is blocked for a clean global install until the private `@maestro/*` workspace dependencies are published or the CLI is bundled**. Publication is manual and not performed by an agent. The current package version is `@maestro/cli@0.1.0`; the package assumes Node.js 24 or newer. Carnegie desktop installers are out of scope.

## Verify the artifact

From the repository root, after `npm ci` and `npm run build`:

```sh
npm pack --dry-run --json --workspace=@maestro/cli
```

The package contains only compiled `dist/**/*.js` and `dist/**/*.d.ts`, `package.json`, `README.md`, and `LICENSE`. It contains no TypeScript source, tests, worktrees, or `node_modules`.

## Manual operator handoff

Do not run this command from an agent session. After reviewing the release decision report and the tarball, the operator may publish the exact version:

```sh
npm publish --workspace=@maestro/cli --access public
```

The pipeable installer uses the published package:

```sh
curl -fsSL https://YOUR_RELEASE_HOST/install.sh | bash
```

It checks Node.js 24 or newer, requests `@maestro/cli@0.1.0` globally, and prints a PATH instruction when npm's global bin directory is not already on PATH. The repository test uses a stub npm command for this control flow; it does **not** claim a clean network install because `@maestro/api-client`, `@maestro/contracts`, `@maestro/domain`, and `@maestro/persistence` are private workspace packages. Set `MAESTRO_NPM_VERSION` for a different explicitly reviewed version. Re-running the script is a normal npm reinstall once dependencies are available.

The release workflow only builds and uploads a `.tgz` artifact. It never runs `npm publish`.
