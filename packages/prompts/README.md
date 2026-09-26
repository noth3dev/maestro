# @maestro/prompts

Every model-facing prompt Maestro sends is written here, so wording can be
reviewed and changed in one place. Callers keep validation and data shaping;
these functions only assemble text.

| Module | Prompt | Used by |
| --- | --- | --- |
| `concertmaster.ts` | `maestroSystemPrompt` — Concertmaster and generic runtime system prompt | `@maestro/agent-runtime` `buildMaestroSystemPrompt` |
| `concertmaster.ts` | `CONCERTMASTER_WORKSPACE_NOTE` — read-only session workspace note | control-plane conversation service |
| `overture.ts` | `overtureRoleSystemPrompt`, crew and workspace guidance | `@maestro/domain` `createOvertureRoleRuntimePolicy` |
| `overture.ts` | `OVERTURE_TRIAGE_SYSTEM_PROMPT`, `overtureTriagePrompt`, `overtureJoinPrompt` | control-plane Overture role turns |
| `review.ts` | `headActivationPrompt` | control-plane Head participation |
| `review.ts` | `encoreReviewerPrompt` | `@maestro/persistence` Encore Council |
| `review.ts` | `semanticReviewerPrompt` | `@maestro/domain` semantic review |

The package has no dependencies, so any layer can use it.
