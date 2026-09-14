import * as LucideIcons from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";

type IconMap = Record<string, ComponentType<LucideProps>>;

function toPascalCase(kebabName: string): string {
  return kebabName.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}

const resolvedIcons = new Map<string, ComponentType<LucideProps>>();

/** Resolves a mockup-style kebab-case icon name (`"git-branch"`) to its lucide-react component, falling back to a generic dot if the name doesn't exist in the installed icon set. */
export function Icon({ name, ...props }: { name: string } & LucideProps) {
  let Component = resolvedIcons.get(name);
  if (Component === undefined) {
    Component = (LucideIcons as unknown as IconMap)[toPascalCase(name)] ?? LucideIcons.Circle;
    resolvedIcons.set(name, Component);
  }
  return <Component {...props} />;
}
