# AI Registry Seeds

## Overview
Built-in registry rows (ADR 0019 §8, ADR 0022 §5, ADR 0025 §5): harnesses, skills, agents, feature bindings, guardrails and prompt texts. Seed data only; consumed by `../registry/seedSync.ts`.

## Interface
- `[index.ts:SEED_HARNESSES]`, `[index.ts:SEED_SKILLS]` (loaded from `skills/<group>/<skill>/SKILL.md` plus sibling files; groups `ai-chat`, `ai-optimizer`, `references`), `[index.ts:SEED_AGENTS]`, `[index.ts:SEED_BINDINGS]`, `[index.ts:MOVED_BINDINGS]`, `[index.ts:RETIRED_AGENTS]`, `[index.ts:seedHash]`.
- `[guardrails.ts:SEED_GUARDRAILS]`.
- `[prompts.ts:OPTIMIZER_PROMPT]`, `[prompts.ts:DEBUGGER_PROMPT]`, `[prompts.ts:FLEET_DOCTOR_PROMPT]`, `[prompts.ts:CHAT_PROMPT]`, `[prompts.ts:TRIAGE_PROMPT]`, `[prompts.ts:EVIDENCE_PROMPTS]` and others.
- `[chatPrompts.ts:ASSISTANT_PROMPT]`, `[chatPrompts.ts:ACCESS_AUDITOR_PROMPT]`, `[chatPrompts.ts:OPERATIONS_ANALYST_PROMPT]`, `[chatPrompts.ts:PLATFORM_AUDITOR_PROMPT]`.

## Invariants
- The runtime reads the registry, never these modules (`index.ts` and `prompts.ts` file headers).
- For seeded guardrails, the enable switch, mode and position are administrator choices that an upgrade keeps (`[guardrails.ts:SEED_GUARDRAILS]` header).

## Side Effects
- At module load `[index.ts:SEED_SKILLS]` reads the `skills/` tree from disk (`readdirSync` / `readFileSync` / `statSync`); otherwise static data.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
