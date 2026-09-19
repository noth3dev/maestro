import { describe, expect, it } from "vitest";
import { createCommandPalette, dispatchCommandPaletteInput } from "./palette.js";

describe("command palette", () => {
  it("lists commands with their read/write safety classification", () => {
    const items = createCommandPalette();
    expect(items.find((item) => item.value === "/goal pause")).toMatchObject({ label: "/goal pause", description: "write" });
    expect(items.find((item) => item.value === "/goal emergency-stop")).toMatchObject({
      label: "/goal emergency-stop",
      description: "critical",
    });
    expect(items.find((item) => item.value === "/goals list")).toMatchObject({ label: "/goals list", description: "read" });
  });
});

it("does not render removed dead Group B entries in help or the command palette", () => {
  const labels = createCommandPalette().map((item) => item.label);
  for (const entry of [
    "/head sleep",
    "/head resume",
    "/worker request-help",
    "/git commit",
    "/git integrate",
    "/git cleanup",
    "/environment list",
    "/environment get",
    "/environment create",
    "/environment cleanup",
    "/device list",
    "/device enroll",
    "/device grant",
    "/device revoke",
    "/device dispatch",
    "/discord list",
    "/discord triage",
    "/discord remediate",
    "/discord close",
    "/portfolio list",
    "/portfolio prioritize",
    "/portfolio pause",
    "/budget forecast",
    "/approval list",
    "/evidence report",
    "/improvement-digests inspect",
  ])
    expect(labels).not.toContain(entry);
});

it("lists local shell commands and the raw keyboard shortcuts", () => {
  const labels = createCommandPalette().map((item) => item.label);
  for (const label of ["/clear", "/exit", "/quit", "/version", "/copy", "Ctrl+G", "Ctrl+E", "Ctrl+R", "Ctrl+A", "Ctrl+/"]) {
    expect(labels).toContain(label);
  }
});

it("prints shortcut labels through the /help and Ctrl+K dispatch paths", () => {
  const labels = ["Ctrl+G", "Ctrl+E", "Ctrl+R", "Ctrl+A", "Ctrl+/"];
  const helpOutput: string[] = [];
  const ctrlKOutput: string[] = [];
  expect(dispatchCommandPaletteInput("help", (text) => helpOutput.push(text))).toBe(true);
  expect(dispatchCommandPaletteInput("\x0b", (text) => ctrlKOutput.push(text))).toBe(true);
  for (const label of labels) {
    expect(helpOutput.join("\n")).toContain(label);
    expect(ctrlKOutput.join("\n")).toContain(label);
  }
  expect(helpOutput.join("\n")).toContain("More commands above · PgUp/PgDn scroll");
  expect(ctrlKOutput.join("\n")).toContain("More commands above · PgUp/PgDn scroll");
});

it("does not reserve literal question marks for the command palette", () => {
  const output: string[] = [];
  expect(dispatchCommandPaletteInput("?", (text) => output.push(text))).toBe(false);
  expect(output).toEqual([]);
});
