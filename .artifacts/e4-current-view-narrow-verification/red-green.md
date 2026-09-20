# RED/GREEN evidence

- RED: `npx vitest run apps/cli/src/tui/components/sidebar.test.ts` failed 1/30 with `TypeError: renderNarrowCurrentView is not a function` after the new behavior assertion was added.
- GREEN: the same suite passed 30/30 after the smallest helper implementation.
- Related focused suites passed 66/66 (`sidebar.test.ts`, `sidebar-nav.test.ts`, `lifecycle-sidebar.test.ts`).
- Full CLI log is `cli.log`; root build log is `build.log`.
