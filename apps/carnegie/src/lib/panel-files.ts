export type PanelFileKind = "markdown" | "code" | "canvas" | "text";

export type PanelFile = {
  path: string;
  kind: PanelFileKind;
  /** Highlighting hint for `code` files, e.g. `ts`. */
  language?: string;
  content: string;
};

const codeLanguages: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  json: "json",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  sh: "shell",
  sql: "sql",
  css: "css",
  html: "html",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
};

/** Decide how the panel renders a file from its name alone. */
export function panelFileKind(path: string): Pick<PanelFile, "kind" | "language"> {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  const extension = dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
  if (extension === "md" || extension === "markdown") return { kind: "markdown" };
  if (extension === "canvas" || extension === "svg") return { kind: "canvas" };
  const language = codeLanguages[extension];
  return language === undefined ? { kind: "text" } : { kind: "code", language };
}

export type FileTreeNode = { name: string; path: string; children?: FileTreeNode[] };

/** Build a folder tree (folders first, then files, each alphabetical) from flat file paths. */
export function buildFileTree(paths: readonly string[]): FileTreeNode[] {
  const root: FileTreeNode = { name: "", path: "", children: [] };
  for (const path of paths) {
    const parts = path.split("/").filter((part) => part !== "");
    let node = root;
    parts.forEach((part, index) => {
      const nodePath = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      node.children ??= [];
      let child = node.children.find((candidate) => candidate.name === part && (candidate.children === undefined) === isFile);
      if (child === undefined) {
        child = isFile ? { name: part, path: nodePath } : { name: part, path: nodePath, children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (nodes: FileTreeNode[]): FileTreeNode[] =>
    nodes
      .sort((left, right) => Number(left.children === undefined) - Number(right.children === undefined) || left.name.localeCompare(right.name))
      .map((node) => (node.children === undefined ? node : { ...node, children: sort(node.children) }));
  return sort(root.children ?? []);
}
