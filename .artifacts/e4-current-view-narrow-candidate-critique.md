# E4 narrow current-view candidate critique

Finding: at 80x24 the sidebar is intentionally hidden, so the current top-level view marker disappears.

Candidates:
- A: render one non-interactive `view · <NAV_ROWS label>` line in the main column only when the sidebar is effectively hidden and rows are at least 16.
- B: add a compressed narrow sidebar overlay.
- C: leave the layout unchanged and rely on footer/keyboard hints.

Independent verdict: **A > B > C; choose A**. A directly closes the narrow discoverability gap with one render-only line, reuses `NAV_ROWS`, and preserves sidebar click/focus behavior. B adds overlay z-order, click-coordinate, and narrow-height risk. C leaves the blind finding unresolved. The marker must use `isSidebarVisible(...)` for effective visibility, hide below 16 rows, and never mutate state or reuse the `›` focus marker.

Source evidence reviewed: `apps/cli/src/tui/components/sidebar.ts`, `apps/cli/src/tui/loop/controller.ts`, `apps/cli/src/tui/loop/lifecycle.ts`, `apps/cli/src/tui/components/sidebar-nav.ts`.
