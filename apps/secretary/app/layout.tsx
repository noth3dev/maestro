import type { ReactNode } from "react";
import "./styles.css";

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
