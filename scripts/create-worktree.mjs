#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, statSync, symlinkSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const [, , branch, base = "HEAD"] = process.argv;
if (!branch || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes("..")) {
  console.error("Usage: npm run worktree:add -- <branch> [base]");
  process.exit(2);
}
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const slug = branch.replaceAll("/", "-");
const worktree = join(root, ".worktrees", slug);
if (existsSync(worktree)) {
  console.error(`Worktree already exists: ${worktree}`);
  process.exit(1);
}
execFileSync("git", ["worktree", "add", worktree, "-b", branch, base], { cwd: root, stdio: "inherit" });

const sharedModules = join(root, "node_modules");
if (!lstatSync(sharedModules, { throwIfNoEntry: false })) {
  console.error(`Shared node_modules is missing: ${sharedModules}`);
  process.exit(1);
}

function linkShared(target, linkPath) {
  try {
    if (statSync(target).isDirectory()) {
      symlinkSync(target, linkPath, "junction");
      return;
    }
  } catch {
    // Fall through to a file link attempt below.
  }
  try {
    symlinkSync(target, linkPath);
  } catch {
    copyFileSync(target, linkPath);
  }
}

// A plain root symlink would resolve @maestro/* workspace links to the main
// checkout, so worktree edits to packages/ would run against stale dist.
// Instead build a farm: everything shared, except the @maestro scope which
// is re-pointed at this worktree's own packages/apps.
const farm = join(worktree, "node_modules");
mkdirSync(farm, { recursive: true });
for (const entry of readdirSync(sharedModules)) {
  if (entry === "@maestro") continue;
  linkShared(join(sharedModules, entry), join(farm, entry));
}
const farmScope = join(farm, "@maestro");
const mainScope = join(sharedModules, "@maestro");
if (lstatSync(mainScope, { throwIfNoEntry: false })) {
  mkdirSync(farmScope, { recursive: true });
  for (const entry of readdirSync(mainScope)) {
    const mainLink = join(mainScope, entry);
    let target;
    try {
      target = resolve(mainScope, readlinkSync(mainLink));
    } catch {
      target = resolve(mainLink);
    }
    const rebased = target.startsWith(root + "/") ? join(worktree, target.slice(root.length + 1)) : target;
    linkShared(rebased, join(farmScope, entry));
  }
}

// Nested third-party modules (apps/*/node_modules hold no workspace links)
// are shared whole; without them worktree builds and tests fail.
for (const entry of readdirSync(join(root, "apps"))) {
  const nested = join(root, "apps", entry, "node_modules");
  if (lstatSync(nested, { throwIfNoEntry: false })) {
    linkShared(nested, join(worktree, "apps", entry, "node_modules"));
  }
}

// Sanity: @maestro/* inside the farm must resolve under this worktree.
for (const entry of readdirSync(farmScope)) {
  const resolved = resolve(farmScope, readlinkSync(join(farmScope, entry)));
  if (!resolved.startsWith(worktree + "/")) {
    console.error(`Farm miswired: @maestro/${entry} resolves outside the worktree (${resolved})`);
    process.exit(1);
  }
}
console.log(`Created ${worktree}`);
console.log(`node_modules farm at ${relative(root, farm)} (@maestro/* -> worktree, rest shared)`);
