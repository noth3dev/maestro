# Maestro TUI Design

- **Date:** 2026-09-09
- **Status:** Design specification. Not implemented.
- **Owning plan:** Phase 3 — [`../phase-03-certification-release.md`](../phase-03-certification-release.md) § *CLI TUI acceptance*
- **Scope:** `apps/cli/src/tui`. Layout, information hierarchy, and interaction. Not authority, not data boundaries — Phase 1 owns those and they do not change.
- **References:** [Codex TUI style guide](https://github.com/openai/codex/blob/main/codex-rs/tui/styles.md) (colour discipline); [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) (same `pi` framework, session continuity patterns).

---

## 1. Why this document exists

The roadmap defines the TUI's *authority* boundary (Phase 1) and its *truthfulness* requirement (Phase 3), but nothing owns how it looks or how it is operated. Meanwhile the TUI is the only surface a human touches until Carnegie ships in Phase 7, and the Phase 3 fourteen-step release gate is driven through it. A screen that is hard to read makes that gate hard to run.

Three goals, in priority order when they conflict:

1. **Operable** — the next decision is always obvious and never more than one keystroke away.
2. **Legible** — the organization's state is readable at a glance, on any terminal.
3. **Beautiful** — in a terminal that means restraint, rhythm, and alignment. Not ornament.

---

## 2. What is wrong today

Measured against `apps/cli/src/tui/components/shell.ts` and `theme.ts` as of `2026-09-09`.

| # | Problem | Evidence |
| --- | --- | --- |
| **P1** | **Chrome crowds out content.** The status header is a splash screen rendered on every frame: 23-row ASCII logo, `✦ MAESTRO`, `I AM YOUR MUZE`, four tip lines, and eight label/value rows. On a 40-row terminal roughly 12 rows remain for the conversation. | `renderShell` → `renderStatusHeader` → `wideStatusRows` |
| **P2** | **No hierarchy in status.** `workspace`, `git root`, `goal`, `model`, `status`, `workers`, `approvals`, `budget` are eight equal rows. `git root` rarely matters; `approvals` is the only item that blocks progress. They look the same. | `wideStatusRows` right column |
| **P3** | **Pending decisions are a counter.** `approvals 3` is one muted cell. The thing the operator exists to do is the least visible thing on screen. | `compactStatusRows`, `wideStatusRows` |
| **P4** | **Two layouts, one breakpoint.** `width < 100 \|\| height < 28` picks compact or wide. Nothing between, nothing below. | `renderStatusHeader` |
| **P5** | **Layout is coupled to the artwork.** `splitRow` hardcodes `Math.min(50, …)` because the logo is 50 columns wide. | `splitRow` |
| **P6** | **The footer is static.** The same keybinding list renders whether the system is idle, working, or blocked on the user. | `renderTuiFooter` |
| **P7** | **No single layout authority.** `renderShell` emits header + conversation heading; the five panels in `panels/` are composed elsewhere in the 883-line `entry.ts`. | `entry.ts` |
| **P8** | **Unreadable on light terminals.** Hardcoded 24-bit foregrounds from a palette the file itself labels "(dark theme)", with the background deliberately unpainted. No `NO_COLOR`. | `theme.ts` — fixed separately by plan-2 § S0 |

---

## 3. The organizing idea

> **Split the screen by who must act: what needs *you*, and what is proceeding without you.**

Everything else follows from this. It is also what makes the design Maestro's rather than a generic agent TUI — Prime Agent has nothing to approve, and Codex has a single yes/no prompt. Maestro runs a four-tier ladder with items pending at different tiers, and operating that ladder *is* the job.

Three consequences:

- **Pending decisions get their own region**, not a counter. The region appears when non-empty and disappears when empty, so an idle system shows no chrome for it.
- **Chrome is proportional to what it says.** The splash is shown once, then collapses into a single status row. Ornament that repeats stops being ornament and becomes noise.
- **Everything else is on demand.** Five panels, 18 command groups, evidence, budget detail — invoked, not resident.

---

## 4. Layout

### 4.1 Regions

```
┌───────────────────────────────────────────────────────────────┐
│ STATUS      1 row, always                                     │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│ STREAM      all remaining height                              │
│             conversation + activity, one chronological column │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│ DECISIONS   0–5 rows, only when something needs the user      │
├───────────────────────────────────────────────────────────────┤
│ INPUT       1–3 rows, grows with the composer                 │
│ HINTS       1 row, contextual                                 │
└───────────────────────────────────────────────────────────────┘
```

The stream is the only region that expands. Every other region is bounded and most can reach zero.

### 4.2 Status row

One row, ranked left to right by how often it changes the operator's next action:

```
maestro · auth-refactor running · 3 workers · $1.24/$5.00        ⏸ 2 need you
```

- Mode, Goal name, Goal state, worker count, budget — left, in that order.
- Pending count — right-aligned, and **the only element permitted an accent colour** when non-zero.
- `workspace`, `git root`, `model`, connection detail move to `/status`. They are answers to questions the operator asks occasionally, not state they monitor.
- Connection trouble replaces the whole row rather than adding to it: `⚠ gateway unavailable · retrying (3)`. A degraded system should not still be reporting budget.

### 4.3 Decisions region

Appears only when at least one item awaits the user. Never scrolls; if more than three items are pending, it shows the top two and a count.

```
──────────────────────────────────────────────────────────────
 ⏸ Encore Council   git push origin main          worker-3
 ⏸ You              rm -rf build/                 worker-1
   +1 more · ctrl+a to review
──────────────────────────────────────────────────────────────
```

Tier is named, not numbered. `You` is written as `You`, never as "tier 4" — the operator should not have to translate.

### 4.4 Stream

One chronological column, not split panes. Conversation turns and effect events interleave in the order they happened, because they are causally related — a worker acts *because* of what was said.

```
  you    add rate limiting to the login route

  ◆ Concertmaster
         I'll draft a Task Contract for this. It touches auth,
         so Security will need to weigh in.

  ● worker-3  editing src/auth/login.ts          ordinary · auto
  ● worker-3  running npm test                   ordinary · auto
  ⏸ worker-3  git push origin main               critical · Encore
```

Effect lines carry their classification and how they were permitted (specified by plan-2 § S4). This is the screen Prime Agent cannot draw: it states plainly that it runs model-generated code "with your user permissions… not a security sandbox." Maestro's entire architecture exists to be the opposite of that sentence, and this is where the difference becomes visible rather than merely true.

### 4.5 Hints row

Contextual, not a fixed keybinding list:

| State | Hint |
| --- | --- |
| idle | `/ commands · ctrl+g goals · ? help` |
| working | `esc stop · ctrl+a decisions (2)` |
| awaiting user | `ctrl+a review 2 pending decisions` |
| disconnected | `ctrl+r retry · /status for detail` |

---

## 5. Responsive behaviour

Replace the single `width < 100 || height < 28` breakpoint with independent width and height rules. The stream is always the last thing sacrificed.

**Width**

| Width | Behaviour |
| --- | --- |
| ≥ 100 | Full status row; decisions show tier, action, and actor |
| 80–99 | Status row drops budget; decisions drop the actor column |
| 60–79 | Status row keeps mode, Goal state, and pending count only |
| < 60 | Status row becomes Goal state + pending count; decisions become a one-line summary |

**Height**

| Height | Behaviour |
| --- | --- |
| ≥ 24 | All regions |
| 16–23 | Decisions region caps at two rows |
| < 16 | Status and input only; decisions collapse into the status row's pending count |

The splash never renders below 100×28, and never renders twice in a session.

---

## 6. Splash

The mark is worth keeping — once. On first render of a session it is shown with the getting-started copy, then replaced by the status row on the first input or the first event, whichever comes first. It does not return.

Rationale: the logo's job is to say "this is Maestro" and orient a new user. Both are done in one showing. Repeating it every frame converts identity into obstruction, which is the current state (P1).

---

## 7. Colour

Adopt the Codex rules. Implementation of the capability tiers belongs to plan-2 § S0; this section fixes the semantics.

- Body text uses the **terminal's default foreground**. Do not paint it.
- Colour only carries meaning:

| Meaning | Colour |
| --- | --- |
| System voice (Concertmaster) | accent |
| Success, completed, certified | green |
| Error, denied, forbidden | red |
| Awaiting user / degraded | yellow |
| Selection, input affordance | cyan |

- Everything else is default or dim. Dim is the workhorse; accent is rationed.
- Never encode meaning in colour alone — every state also carries a glyph (`●` running, `⏸` awaiting, `✓` done, `✗` denied) so the screen survives `NO_COLOR` and colour-blind operators.
- Three tiers: truecolor (Warm Earth), ANSI-16 (fallback), none (`NO_COLOR`).

---

## 8. Rhythm and alignment

What "beautiful" means here, concretely:

- **One indent unit: two spaces.** Nesting never exceeds two levels.
- **Column alignment across a group.** Effect lines align actor, action, target, and classification into fixed columns so the eye scans vertically.
- **Blank lines separate speakers, not every line.** One blank before a new speaker; none within a turn.
- **Rules are structural, not decorative.** A horizontal rule appears only where a region boundary exists — currently `horizontalRule` is emitted decoratively inside the header.
- **No box-drawing around the conversation.** Frames cost two columns per side and buy nothing; the region boundary already reads from spacing.

---

## 9. Exposing all of Maestro

The system has 18 command groups, five panels, an organization of Heads and Councils, evidence, certification, and budget. Almost none of it is discoverable from the screen.

- **The organization becomes visible in the stream.** When a Head wakes, a Council convenes, or a certification is issued, it appears as an event — not only as a panel someone has to know to open. This is the product's central claim and it is currently invisible.
- **Panels are overlays, invoked and dismissed** (`ctrl+g` goals, `ctrl+e` events, `ctrl+a` decisions, `/panel <name>`). They never occupy resident space.
- **Command discovery stays in the palette**, but the hints row surfaces the two commands relevant to the current state rather than a fixed list.
- **Goal attach.** Prime Agent has `agents` and `attach <id>` for reconnecting to running sessions. Maestro's continuity is stronger — durable in PostgreSQL rather than tied to a daemon, with SSE cursor reconnect already delivered by plan-1 § S3 — but it has no surface. `/goals` should distinguish live Goals and allow attaching to one. This becomes mandatory in Phase 5, where three Goals run concurrently.

---

## 10. Non-goals

- No second execution path. The TUI remains a presentation surface; a keypress is not authority (Phase 1 boundary, unchanged).
- No replacement of `@earendil-works/pi-tui`.
- No mouse support.
- No theming configuration beyond the three colour tiers.
- Carnegie (Phase 7) is a separate surface with its own design; this document does not constrain it.

---

## 11. Acceptance

The design is satisfied when:

1. On an 80×24 terminal, the conversation region occupies at least 70 percent of available height at rest.
2. A pending decision is visible without scrolling, without opening a panel, and reachable in one keystroke.
3. The screen is readable on a light-background terminal and under `NO_COLOR`.
4. Every state that carries colour also carries a distinguishing glyph.
5. The splash renders at most once per session.
6. Head activation, Council convening, and certification appear in the stream without the operator opening a panel.
7. A reader can tell, for any effect line, what classification it had and how it was permitted.
