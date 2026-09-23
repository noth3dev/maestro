import type { ModelCatalogEntry } from "@maestro/contracts";

export function modelRef(model: ModelCatalogEntry): string {
  return `${model.identity.provider}/${model.identity.id}`;
}

export function sortLiveModels(models: readonly ModelCatalogEntry[]): ModelCatalogEntry[] {
  return [...models].sort((left, right) => modelRef(left).localeCompare(modelRef(right)));
}

export function resolveDefaultModelRef(models: readonly ModelCatalogEntry[], savedModelRef: string | undefined): string | undefined {
  const sorted = sortLiveModels(models);
  if (savedModelRef !== undefined && sorted.some((model) => modelRef(model) === savedModelRef)) return savedModelRef;
  return sorted[0] === undefined ? undefined : modelRef(sorted[0]);
}

export function concertmasterModelStorageKey(projectId: string): string {
  return `maestro:concertmaster-model:${projectId}`;
}

export function readSavedConcertmasterModelRef(projectId: string): string | undefined {
  try {
    return globalThis.localStorage.getItem(concertmasterModelStorageKey(projectId)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveConcertmasterModelRef(projectId: string, value: string): void {
  try {
    globalThis.localStorage.setItem(concertmasterModelStorageKey(projectId), value);
  } catch {
    // The server conversation record remains authoritative when local storage is unavailable.
  }
}
