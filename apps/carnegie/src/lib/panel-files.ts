export type PanelFileKind = "markdown" | "code" | "canvas" | "text";

/** How a `canvas` file is drawn: a rendered page, vector markup, or a raster image. */
export type CanvasRender = "html" | "svg" | "image";

export type PanelFile = {
  path: string;
  kind: PanelFileKind;
  /** Highlighting hint for `code` files, e.g. `ts`. */
  language?: string;
  /** Set for `canvas` files. */
  render?: CanvasRender;
  /** MIME type for raster images. */
  mime?: string;
  content: string;
  /** Raster images arrive base64-encoded. */
  encoding?: "base64";
};

const imageMime: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

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
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
};

/** Decide how the panel renders a file from its name alone. */
export function panelFileKind(path: string): Pick<PanelFile, "kind" | "language" | "render" | "mime"> {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  const extension = dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
  if (extension === "md" || extension === "markdown") return { kind: "markdown" };
  if (extension === "html" || extension === "htm") return { kind: "canvas", render: "html" };
  if (extension === "svg" || extension === "canvas") return { kind: "canvas", render: "svg" };
  const mime = imageMime[extension];
  if (mime !== undefined) return { kind: "canvas", render: "image", mime };
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
