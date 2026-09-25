import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveRoutingCandidates, readRoutingCandidateCatalog, readRoutingModelMap } from "./ensemble-candidate-catalog.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function catalogFile(entries: unknown): { modelMapPath: string; catalogPath: string; original: string } {
  const directory = mkdtempSync(join(tmpdir(), "maestro-routing-catalog-"));
  tempDirs.push(directory);
  const modelMapPath = join(process.cwd(), "config", "model_map.json");
  const catalogPath = join(directory, "candidates.json");
  writeFileSync(catalogPath, JSON.stringify({ schemaVersion: 1, entries }), "utf8");
  return { modelMapPath, catalogPath, original: readFileSync(modelMapPath, "utf8") };
}

describe("production routing candidate catalog", () => {
  it("reads human-owned capability scores and explicit candidate/account bindings without rewriting model_map", () => {
    const files = catalogFile([
      { candidateRef: "sol-primary", modelRef: "openai/gpt-5.6-sol", accountBinding: "openai-local-operator" },
      { candidateRef: "opus-review", modelRef: "anthropic/claude-opus-5", accountBinding: "anthropic-local-operator" },
    ]);
    const catalog = readRoutingCandidateCatalog(files);
    expect(catalog.modelMap.entries.map((entry) => entry.modelRef)).toContain("openai/gpt-5.6-sol");
    expect(catalog.candidates).toEqual([
      { candidateRef: "sol-primary", modelRef: "openai/gpt-5.6-sol", accountBinding: "openai-local-operator" },
      { candidateRef: "opus-review", modelRef: "anthropic/claude-opus-5", accountBinding: "anthropic-local-operator" },
    ]);
    expect(readFileSync(files.modelMapPath, "utf8")).toBe(files.original);
  });

  it("accepts a valid empty candidate list as a known empty set", () => {
    const files = catalogFile([]);
    const catalog = readRoutingCandidateCatalog(files);
    expect(catalog.candidates).toEqual([]);
    expect(Object.isFrozen(catalog.candidates)).toBe(true);
  });

  it("fails closed when a catalog model is absent from the human-owned model_map", () => {
    const files = catalogFile([{ candidateRef: "unknown", modelRef: "provider/not-in-model-map", accountBinding: "account" }]);
    expect(() => readRoutingCandidateCatalog(files)).toThrow(/model_map|modelRef/i);
  });

  it("rejects duplicate or provider-qualified candidate references", () => {
    const duplicate = catalogFile([
      { candidateRef: "same", modelRef: "openai/gpt-5.6-sol", accountBinding: "openai-local-operator" },
      { candidateRef: "same", modelRef: "anthropic/claude-opus-5", accountBinding: "anthropic-local-operator" },
    ]);
    expect(() => readRoutingCandidateCatalog(duplicate)).toThrow(/duplicate/i);

    const qualified = catalogFile([{ candidateRef: "openai/gpt-5.6-sol", modelRef: "openai/gpt-5.6-sol", accountBinding: "openai-local-operator" }]);
    expect(() => readRoutingCandidateCatalog(qualified)).toThrow(/opaque|candidateRef/i);
  });
});

describe("derived routing candidates", () => {
  const modelMap = readRoutingModelMap(join(process.cwd(), "config", "model_map.json"));
  const accountRefs = { openai: "openai-op", "openai-codex": "openai-codex-op" };

  it("admits only live, profiled models whose provider has an account binding", () => {
    const candidates = deriveRoutingCandidates({
      modelMap,
      liveModelRefs: ["openai/gpt-5.6-sol", "openai/unprofiled-model", "anthropic/claude-opus-5"],
      accountRefs,
    });
    expect(candidates).toEqual([{ candidateRef: "openai:gpt-5.6-sol", modelRef: "openai/gpt-5.6-sol", accountBinding: "openai-op" }]);
  });

  it("keeps openai-codex identities distinct from openai identities", () => {
    const candidates = deriveRoutingCandidates({ modelMap, liveModelRefs: ["openai-codex/gpt-5.6-sol"], accountRefs });
    expect(candidates).toEqual([
      { candidateRef: "openai-codex:gpt-5.6-sol", modelRef: "openai-codex/gpt-5.6-sol", accountBinding: "openai-codex-op" },
    ]);
  });

  it("derives no candidates when no live model is profiled", () => {
    expect(deriveRoutingCandidates({ modelMap, liveModelRefs: ["example/new-model"], accountRefs })).toEqual([]);
  });
});
