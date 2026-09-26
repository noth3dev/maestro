import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProjectSummary } from "@maestro/contracts";
import { ProjectScopedConnection, useConnection } from "./connection.js";

const SELECTED_PROJECT_KEY = "maestro.selectedProjectId";

interface ProjectsContextValue {
  /** Named projects, Home first; undefined until the first load. */
  projects: readonly ProjectSummary[] | undefined;
  /** The operator's Home project (the global workspace). */
  homeProjectId: string;
  /** The project whose views are shown (dashboard, board, channels, Goals …). */
  projectId: string;
  selectProject: (projectId: string) => void;
  createProject: (name: string) => Promise<ProjectSummary>;
  renameProject: (projectId: string, name: string) => Promise<ProjectSummary>;
  refresh: () => Promise<void>;
  error: string | undefined;
}

const ProjectsContext = createContext<ProjectsContextValue | undefined>(undefined);

function readSaved(): string | undefined {
  try {
    return window.localStorage.getItem(SELECTED_PROJECT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function save(projectId: string): void {
  try {
    window.localStorage.setItem(SELECTED_PROJECT_KEY, projectId);
  } catch {
    // Remembering the selection is a convenience.
  }
}

/** The selected project if it still exists, else Home. */
export function resolveSelectedProject(selected: string | undefined, projects: readonly ProjectSummary[] | undefined, homeProjectId: string): string {
  if (selected === undefined) return homeProjectId;
  if (projects === undefined) return selected;
  return projects.some((project) => project.projectId === selected) ? selected : homeProjectId;
}

/**
 * Knows every project and which one is selected. Below it, `useConnection()`
 * reports the selected project, so project-scoped views follow the dropdown;
 * global views (Concertmaster, inbox, billing) use this context directly.
 */
export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { config } = useConnection();
  const homeProjectId = config!.projectId;
  const [projects, setProjects] = useState<readonly ProjectSummary[] | undefined>(undefined);
  const [selected, setSelected] = useState<string | undefined>(readSaved);
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setProjects((await window.maestro.api.listProjectCatalog()).projects);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Projects are unavailable");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, homeProjectId]);

  const selectProject = useCallback((projectId: string) => {
    setSelected(projectId);
    save(projectId);
  }, []);

  const createProject = useCallback(
    async (name: string) => {
      const created = await window.maestro.api.createProject({ name }, globalThis.crypto.randomUUID());
      await refresh();
      return created;
    },
    [refresh],
  );

  const renameProject = useCallback(
    async (projectId: string, name: string) => {
      const renamed = await window.maestro.api.renameProject(projectId, { name });
      await refresh();
      return renamed;
    },
    [refresh],
  );

  const projectId = resolveSelectedProject(selected, projects, homeProjectId);
  const value = useMemo<ProjectsContextValue>(
    () => ({ projects, homeProjectId, projectId, selectProject, createProject, renameProject, refresh, error }),
    [projects, homeProjectId, projectId, selectProject, createProject, renameProject, refresh, error],
  );

  return (
    <ProjectsContext.Provider value={value}>
      <ProjectScopedConnection projectId={projectId}>{children}</ProjectScopedConnection>
    </ProjectsContext.Provider>
  );
}

const unavailable = async (): Promise<never> => {
  throw new Error("Projects are not loaded");
};

/**
 * Outside a ProjectsProvider (isolated views and fixtures) the connection's
 * single project is both Home and the selection.
 */
export function useProjects(): ProjectsContextValue {
  const value = useContext(ProjectsContext);
  const { config } = useConnection();
  if (value !== undefined) return value;
  const projectId = config?.projectId ?? "";
  return { projects: undefined, homeProjectId: projectId, projectId, selectProject: () => undefined, createProject: unavailable, renameProject: unavailable, refresh: async () => undefined, error: undefined };
}

/** Display name for a project id (falls back to a short id while the catalog loads). */
export function projectName(projects: readonly ProjectSummary[] | undefined, projectId: string): string {
  return projects?.find((project) => project.projectId === projectId)?.name ?? `project ${projectId.slice(0, 8)}`;
}
