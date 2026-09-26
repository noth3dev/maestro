import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../icons.js";
import { projectName, useProjects } from "../projects.js";

/** Dropdown above the profile: pick the project whose views are shown, or create one. */
export function ProjectSwitcher() {
  const { projects, projectId, selectProject, createProject, error } = useProjects();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setCreating(false);
    setName("");
    setCreateError(undefined);
  }

  function choose(id: string) {
    selectProject(id);
    close();
    trigger.current?.focus();
  }

  async function submit() {
    if (name.trim() === "" || busy) return;
    setBusy(true);
    setCreateError(undefined);
    try {
      const created = await createProject(name);
      choose(created.projectId);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Could not create the project");
    } finally {
      setBusy(false);
    }
  }

  function onListKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      trigger.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="option"], .pj-new') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
    event.preventDefault();
    next?.focus();
  }

  const current = projects?.find((project) => project.projectId === projectId);

  return (
    <div className="pj-switcher" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="pj-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Project: ${projectName(projects, projectId)}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className={`pj-dot${current?.kind === "home" ? " pj-dot-home" : ""}`} aria-hidden="true" />
        <span className="lbl pj-name">{projectName(projects, projectId)}</span>
        <Icon name="chevrons-up-down" className="pj-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="pj-menu" onKeyDown={onListKey}>
          <div role="listbox" aria-label="Projects">
            {(projects ?? []).map((project) => (
              <button
                key={project.projectId}
                type="button"
                role="option"
                aria-selected={project.projectId === projectId}
                className={`pj-option${project.projectId === projectId ? " on" : ""}`}
                onClick={() => choose(project.projectId)}
              >
                <span className={`pj-dot${project.kind === "home" ? " pj-dot-home" : ""}`} aria-hidden="true" />
                <span className="pj-option-name">{project.name}</span>
                {project.activeGoalCount > 0 && <span className="pj-count" title="Goals in progress">{project.activeGoalCount}</span>}
                {project.projectId === projectId && <Icon name="check" className="pj-check" aria-hidden="true" />}
              </button>
            ))}
            {projects === undefined && <div className="pj-empty">{error ?? "Loading projects…"}</div>}
          </div>
          <div className="pj-sep" />
          {creating ? (
            <form className="pj-create" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <input
                autoFocus
                aria-label="New project name"
                placeholder="Project name"
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setCreating(false); } }}
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || name.trim() === ""}>create</button>
              {createError !== undefined && <span className="pj-error" role="alert">{createError}</span>}
            </form>
          ) : (
            <button type="button" className="pj-new" onClick={() => setCreating(true)}>
              <Icon name="plus" aria-hidden="true" /> new project
            </button>
          )}
        </div>
      )}
    </div>
  );
}
