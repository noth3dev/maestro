import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "../icons.js";
import { MarkdownView } from "./MarkdownView.js";
import { buildFileTree, panelFileKind, type FileTreeNode, type PanelFile } from "../lib/panel-files.js";

/**
 * A workspace file browser with tabs. Callers supply file paths and a loader;
 * the panel decides how to render each file (Markdown, code, canvas, text)
 * from its extension, so any workspace (Overture plans, Worker code) can use it.
 */
export function FilePanel({
  title,
  paths,
  loadFile,
  refreshKey,
  emptyHint,
  onClose,
  renderFileActions,
}: {
  title: string;
  /** Workspace-relative file paths; undefined while loading. */
  paths: readonly string[] | undefined;
  loadFile: (path: string) => Promise<string>;
  /** Changes whenever the workspace may have changed, so open tabs reload. */
  refreshKey?: string;
  emptyHint: string;
  onClose: () => void;
  /** Optional actions shown above a file, e.g. Task Contract controls for task.md. */
  renderFileActions?: (path: string) => ReactNode;
}) {
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | undefined>(undefined);
  const [files, setFiles] = useState<Record<string, PanelFile | { path: string; error: string }>>({});
  const [treeOpen, setTreeOpen] = useState(true);
  const tree = useMemo(() => buildFileTree(paths ?? []), [paths]);

  const load = useCallback(
    (path: string) => {
      void loadFile(path)
        .then((content) => setFiles((current) => ({ ...current, [path]: { path, content, ...panelFileKind(path) } })))
        .catch((cause: unknown) =>
          setFiles((current) => ({ ...current, [path]: { path, error: cause instanceof Error ? cause.message : "File is unavailable" } })),
        );
    },
    [loadFile],
  );

  const openFile = (path: string) => {
    setOpenPaths((current) => (current.includes(path) ? current : [...current, path]));
    setActivePath(path);
    if (files[path] === undefined) load(path);
  };

  const closeTab = (path: string) => {
    setOpenPaths((current) => {
      const next = current.filter((candidate) => candidate !== path);
      if (activePath === path) setActivePath(next.at(-1));
      return next;
    });
  };

  // Reload open tabs when the workspace changes; drop tabs whose file disappeared.
  useEffect(() => {
    if (paths === undefined) return;
    const available = new Set(paths);
    setOpenPaths((current) => current.filter((path) => available.has(path)));
    for (const path of openPaths) if (available.has(path)) load(path);
    // Deliberately keyed on workspace changes only.
  }, [refreshKey, paths]);

  // Open the first file automatically so the panel is never blank when files exist.
  useEffect(() => {
    if (activePath === undefined && paths !== undefined && paths.length > 0) openFile([...paths].sort()[0]!);
    // Deliberately keyed on the file list only.
  }, [paths]);

  const active = activePath === undefined ? undefined : files[activePath];

  return (
    <aside className="file-panel" aria-label={title}>
      <div className="file-panel-head">
        <button type="button" className="btn-icon" aria-expanded={treeOpen} aria-label={treeOpen ? "Hide files" : "Show files"} onClick={() => setTreeOpen((current) => !current)}>
          <Icon name="folder-tree" />
        </button>
        <span className="file-panel-title">{title}</span>
        <button type="button" className="btn-icon" aria-label="Close panel" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      {treeOpen && (
        <div className="file-tree" role="tree" aria-label="Workspace files">
          {paths === undefined ? (
            <p className="file-panel-hint">Loading files…</p>
          ) : paths.length === 0 ? (
            <p className="file-panel-hint">{emptyHint}</p>
          ) : (
            <TreeNodes nodes={tree} depth={0} activePath={activePath} onOpen={openFile} />
          )}
        </div>
      )}
      {openPaths.length > 0 && (
        <div className="file-tabs" role="tablist" aria-label="Open files">
          {openPaths.map((path) => {
            const kind = panelFileKind(path).kind;
            return (
              <div key={path} className={`file-tab${path === activePath ? " on" : ""}`}>
                <button type="button" role="tab" aria-selected={path === activePath} title={path} onClick={() => setActivePath(path)}>
                  <Icon name={kind === "canvas" ? "shapes" : kind === "code" ? "file-code" : "file-text"} />
                  <span>{path.split("/").pop()}</span>
                </button>
                <button type="button" className="file-tab-close" aria-label={`Close ${path}`} onClick={() => closeTab(path)}>
                  <Icon name="x" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {activePath !== undefined && renderFileActions?.(activePath)}
      <div className="file-view" role="tabpanel" aria-label={activePath ?? "No file open"}>
        {active === undefined ? (
          activePath === undefined ? null : <p className="file-panel-hint">Loading…</p>
        ) : "error" in active ? (
          <p className="file-panel-hint" role="alert">{active.error}</p>
        ) : (
          <FileView file={active} />
        )}
      </div>
    </aside>
  );
}

function TreeNodes({ nodes, depth, activePath, onOpen }: { nodes: FileTreeNode[]; depth: number; activePath: string | undefined; onOpen: (path: string) => void }) {
  return (
    <>
      {nodes.map((node) =>
        node.children === undefined ? (
          <button
            key={node.path}
            type="button"
            role="treeitem"
            aria-selected={node.path === activePath}
            className={`file-tree-item${node.path === activePath ? " on" : ""}`}
            style={{ paddingLeft: 10 + depth * 14 }}
            onClick={() => onOpen(node.path)}
          >
            <Icon name={panelFileKind(node.path).kind === "canvas" ? "shapes" : "file"} /> {node.name}
          </button>
        ) : (
          <div key={node.path} role="group" aria-label={node.name}>
            <div className="file-tree-folder" style={{ paddingLeft: 10 + depth * 14 }}>
              <Icon name="folder" /> {node.name}
            </div>
            <TreeNodes nodes={node.children} depth={depth + 1} activePath={activePath} onOpen={onOpen} />
          </div>
        ),
      )}
    </>
  );
}

export function FileView({ file }: { file: PanelFile }) {
  if (file.kind === "markdown") return <MarkdownView source={file.content} />;
  if (file.kind === "canvas")
    return (
      // No sandbox permissions: canvas markup can draw but never run scripts or navigate.
      <iframe className="file-canvas" title={file.path} sandbox="" srcDoc={canvasDocument(file.content)} />
    );
  return (
    <pre className="file-code" data-language={file.language}>
      <code>{file.content}</code>
    </pre>
  );
}

function canvasDocument(content: string): string {
  return `<!doctype html><html><head><style>html,body{margin:0;height:100%;background:#fff}body{display:grid;place-items:center}svg{max-width:100%;max-height:100%}</style></head><body>${content}</body></html>`;
}
