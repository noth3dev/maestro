#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, symlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";

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
symlinkSync(relative(dirname(worktree), sharedModules), join(worktree, "node_modules"), "junction");
console.log(`Created ${worktree}`);
console.log(`node_modules -> ${relative(worktree, sharedModules)}`);
