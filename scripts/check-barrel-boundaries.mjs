#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/**
 * Guards package and app import boundaries without new dependencies.
 *
 * Rules enforced:
 * 1. `@maestro/*` imports use the barrel (`.` export) only, except the
 *    sanctioned subpaths `@maestro/persistence/testing` and
 *    `@maestro/agent-runtime/model-provider` (declared in package.json
 *    exports and the vitest alias map).
 * 2. Relative imports stay inside the owning root (`apps/<app>`,
 *    `packages/<pkg>`), except through a barrel index (`src/index.js`), as
 *    `import type` / `export type` (erased at compile, no runtime coupling),
 *    to the shared root fixture `test/git-port.js`, or via the enumerated
 *    EXCEPTIONS below. Production code has zero value-import exceptions.
 *    The `test/` and `scripts/` roots are leaves (nothing imports from them;
 *    they exist to wire the system together), so cross-boundary imports
 *    there are out of scope by design.
 * 3. `dist/` build output is never imported under `apps/` or `packages/`,
 *    except the named process-spawn harness that must boot the built server.
 * 4. `apps/control-plane/src/routes/*` (non-test) may reference
 *    `@maestro/persistence` as `import type` only; runtime coupling must go
 *    through injected services (see routes/deps.ts).
 *
 * Adding an exception requires editing EXCEPTIONS with a per-case reason and
 * reviewer sign-off. Removing a stale entry (listed but no longer found)
 * also fails: the list must describe the tree exactly. Only
 * `*.integration.test.ts` plus the named `.mjs` harness are eligible.
 *
 * Limitations: static `from "..."` / `export ... from "..."` / `import("...")`
 * strings only. Dynamic specifier construction evades this check by design;
 * do not build import paths at runtime across boundaries.
 */
const repoRoot = join(import.meta.dirname, "..");
const scanRoots = ["apps", "packages", "test", "scripts"].map((dir) => join(repoRoot, dir));

const sanctionedSubpaths = new Set(["@maestro/persistence/testing", "@maestro/agent-runtime/model-provider"]);

// Exact { importer repo-relative path, specifier, reason } triples. Production
// code (.ts outside *.test.ts) has no entries: any new one fails the check.
const EXCEPTIONS = [
  {
    importer: "apps/control-plane/src/tui-sse-reconnect.integration.test.ts",
    specifier: "../../cli/src/tui/session.js",
    reason: "cross-app SSE reconnect integration owns no seam of its own",
  },
  {
    importer: "apps/control-plane/src/tui-sse-reconnect.integration.test.ts",
    specifier: "../../cli/src/tui/activity-stream.js",
    reason: "cross-app SSE reconnect integration owns no seam of its own",
  },
  {
    importer: "apps/control-plane/src/tui-sse-reconnect.integration.test.ts",
    specifier: "../../cli/src/tui/commands/read-commands.js",
    reason: "cross-app SSE reconnect integration owns no seam of its own",
  },
  {
    importer: "apps/control-plane/src/tui-sse-reconnect.integration.test.ts",
    specifier: "../../cli/src/tui/components/shell.js",
    reason: "cross-app SSE reconnect integration owns no seam of its own",
  },
  {
    importer: "apps/control-plane/src/tui-sse-reconnect.integration.test.ts",
    specifier: "../../carnegie/electron/event-stream-bridge.js",
    reason: "cross-app SSE reconnect integration owns no seam of its own",
  },
  {
    importer: "apps/carnegie/src/cli-carnegie-parity.integration.test.ts",
    specifier: "../../cli/src/main.js",
    reason: "parity test exists to wire both apps together",
  },
  {
    importer: "apps/carnegie/src/cli-carnegie-parity.integration.test.ts",
    specifier: "../../control-plane/src/main.js",
    reason: "parity test exists to wire both apps together",
  },
  {
    importer: "apps/control-plane/src/read-state-parity.integration.test.ts",
    specifier: "../../cli/src/main.js",
    reason: "CLI-driven parity probe across apps",
  },
  {
    importer: "apps/control-plane/src/channel-route.integration.test.ts",
    specifier: "../../cli/src/tui/commands/read-commands.js",
    reason: "compares TUI command output against the API surface",
  },
  {
    importer: "apps/control-plane/src/channel-route.integration.test.ts",
    specifier: "../../cli/src/tui/commands/write-commands.js",
    reason: "compares TUI command output against the API surface",
  },
  {
    importer: "apps/carnegie/electron/bootstrap.ts",
    specifier: "../../cli/dist/tui/local-bootstrap.js",
    reason: "PROD EXCEPTION: local-backend orchestration owned by CLI; extract to a package as its own finding",
  },
  {
    importer: "apps/carnegie/electron/bootstrap.ts",
    specifier: "../../cli/dist/tui/connection.js",
    reason: "PROD EXCEPTION: local-backend orchestration owned by CLI; extract to a package as its own finding",
  },
  {
    importer: "packages/persistence/src/worker.integration.test.ts",
    specifier: "../../../apps/control-plane/src/ensemble-candidate-catalog.js",
    reason: "worker-store integration through control-plane admission; catalog home undecided",
  },
  {
    importer: "packages/persistence/src/worker.integration.test.ts",
    specifier: "../../../apps/control-plane/src/ensemble-admission.js",
    reason: "worker-store integration through control-plane admission; catalog home undecided",
  },
  {
    importer: "apps/control-plane/src/process-control-plane-harness.mjs",
    specifier: "../dist/main.js",
    reason: "process-spawn harness must boot the built server output",
  },
];

function ownRoot(repoPath) {
  const parts = repoPath.split(sep);
  if (parts[0] === "apps" || parts[0] === "packages") return parts.slice(0, 2).join(sep);
  return null;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === ".git") continue;
      yield* walk(full);
    } else if (name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".mjs")) {
      yield full;
    }
  }
}

function specifiers(source) {
  const found = [];
  const staticRe = /(?:import|export)[^;"']*?from\s*["']([^"']+)["']/g;
  const sideEffectRe = /import\s*["']([^"']+)["']/g;
  const dynamicRe = /import\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [staticRe, sideEffectRe, dynamicRe]) {
    let match;
    while ((match = re.exec(source)) !== null) found.push({ specifier: match[1], statement: match[0] });
  }
  return found;
}

const failures = [];
const seenExceptions = new Set();

for (const root of scanRoots) {
  for (const file of walk(root)) {
    const importer = relative(repoRoot, file).split(sep).join("/");
    const source = readFileSync(file, "utf8");
    const rootBase = ownRoot(importer);
    const isRouteFile =
      importer.startsWith("apps/control-plane/src/routes/") && !importer.endsWith(".test.ts") && !importer.endsWith(".test.tsx");
    for (const { specifier, statement } of specifiers(source)) {
      if (!specifier.startsWith(".") && !specifier.startsWith("@maestro/")) continue;
      const key = `${importer}\0${specifier}`;
      const isDistImport = /(^|\/)dist\//.test(specifier);
      if (isDistImport && rootBase !== null) {
        if (EXCEPTIONS.some((entry) => entry.importer === importer && entry.specifier === specifier)) {
          seenExceptions.add(key);
        } else {
          failures.push(`${importer}: build-output import ${specifier}`);
        }
        continue;
      }
      if (specifier.startsWith("@maestro/")) {
        const bare = specifier.split("/").slice(0, 2).join("/");
        const hasSubpath = specifier.length > bare.length;
        if (hasSubpath && !sanctionedSubpaths.has(specifier)) {
          failures.push(`${importer}: deep package import ${specifier} (use the barrel)`);
        }
        if (isRouteFile && bare === "@maestro/persistence" && !/\bimport\s*type\b/.test(statement)) {
          failures.push(`${importer}: runtime @maestro/persistence import (import type only in routes/*)`);
        }
        continue;
      }
      const resolved = relative(repoRoot, resolve(repoRoot, importer.split("/").slice(0, -1).join("/"), specifier))
        .split(sep)
        .join("/");
      if (rootBase === null) continue;
      // Barrels are valid crossing points; type-only imports are erased at
      // compile time; the root test fixture is shared infra like test/setup.ts.
      if (resolved.endsWith("/src/index.js")) continue;
      if (/^\s*(import|export)\s*type\b/.test(statement)) continue;
      if (resolved === "test/git-port.js") continue;
      const escapes = resolved !== rootBase && !resolved.startsWith(`${rootBase}/`);
      if (!escapes) continue;
      if (EXCEPTIONS.some((entry) => entry.importer === importer && entry.specifier === specifier)) {
        seenExceptions.add(key);
        continue;
      }
      failures.push(`${importer}: cross-boundary relative import ${specifier} (-> ${resolved})`);
    }
  }
}

for (const entry of EXCEPTIONS) {
  if (!seenExceptions.has(`${entry.importer}\0${entry.specifier}`)) {
    failures.push(`stale exception (no longer found, remove it): ${entry.importer} <- ${entry.specifier}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log(`Boundary check OK: ${seenExceptions.size}/${EXCEPTIONS.length} enumerated exceptions verified.`);
