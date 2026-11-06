# AI Agent Registry

## Overview
The AI agent registry (ADR 0019): every DeepAgents agent is a registry row (prompt, model, tools, skills, subagents, harness, tuning) bound to features. This package persists, validates, caches and assembles those rows into an agent tree per run, and holds the tool catalog and AI drafting logic for agents, harnesses and skills.

## Interface
- Persistence: `[store.ts:loadSnapshot]`, `[store.ts:getRegistryVersion]`, `[store.ts:saveAgent]`, `[store.ts:saveHarness]`, `[store.ts:saveSkill]`, `[store.ts:saveGuardrail]`, `[store.ts:setBinding]`, `[store.ts:listRevisions]`.
- Cache: `[cache.ts:getRegistrySnapshot]`, `[cache.ts:resetRegistryCache]`.
- Management: `[service.ts:createAgent]`, `[service.ts:updateAgent]`, `[service.ts:deleteAgent]`, `[service.ts:bindFeature]`, `[service.ts:resetAgent]`, `[service.ts:rollback]`, `[service.ts:builtInUpdateAvailable]` (and harness/skill equivalents).
- Validation: `[validation.ts:validateGraph]`, `[validation.ts:introducedProblems]`, `[validation.ts:parseSkillFrontMatter]`; schemas `[schemas.ts:agentSchema]`, `[schemas.ts:harnessSchema]`, `[schemas.ts:skillSchema]`.
- Runtime assembly: `[builder.ts:buildAgentTree]`, `[builder.ts:featureRuntime]`, `[builder.ts:MAX_AGENT_DEPTH]`; `[harness.ts:harnessToolMiddleware]`, `[harness.ts:registerHarnessBaseline]`; `[skillsBackend.ts:RegistrySkillsBackend]`; `[skillTools.ts:withSkillIncludeTools]`; `[template.ts:renderTemplate]`, `[template.ts:validateTemplate]`; `[tuning.ts:normalizeTuning]`.
- Tool catalog: `[catalog.ts:TOOL_CATALOG]`, `[catalog.ts:buildGrantedTools]`, `[catalog.ts:userMayUseTool]`, `[catalog.ts:describeCatalog]`, `[catalog.ts:catalogTool]` (lookup by name).
- Chat agents: `[chatAgents.ts:chatAgentCandidates]`, `[chatAgents.ts:userMayUseAgent]`.
- In-process API: `[inProcessApi.ts:InProcessApiClient]`, `[inProcessApi.ts:registerInProcessApi]`, `[inProcessApi.ts:InProcessApiError]`; user-agent markers `[inProcessApi.ts:ASSISTANT_USER_AGENT]` (AI proposals) and `[inProcessApi.ts:CHAT_ACTION_USER_AGENT]` (chat-app button presses).
- Seeds and summary: `[seedSync.ts:syncRegistrySeeds]`, `[summary.ts:summarizeRegistry]`.
- Drafting (issue #381): `[drafting.ts:assessAgent]`, `[drafting.ts:repairAgent]`, `[draftRunner.ts:runDraft]`, `[draftSchemas.ts:AgentDraftSchema]`, `[draftSchemas.ts:draftRequestSchema]`.

## Invariants
- Every write bumps `ai_registry_state.version`; snapshots are reused only while that counter is unchanged, so edits reach every replica (`[store.ts:getRegistryVersion]`, `[cache.ts:getRegistrySnapshot]`).
- Every management write is validated against the whole registry (a change may not introduce problems) and recorded as a revision (`[service.ts:createAgent]`, `[validation.ts:introducedProblems]`).
- The tool catalog is the only place an AI tool is defined; admins compose agents but never define tool behaviour (`[catalog.ts:TOOL_CATALOG]`).
- Management tools never read the metadata DB directly; they issue subrequests against the app as the chatting user (`[inProcessApi.ts:InProcessApiClient]`).
- Templates interpret only three forms; everything else is literal (`[template.ts:renderTemplate]`).
- Seed sync is idempotent and safe on every boot on every replica (`[seedSync.ts:syncRegistrySeeds]`).
- Skills backend is read-only (`[skillsBackend.ts:RegistrySkillsBackend]`).

## Side Effects
- Writes `ai_agents`, `ai_harnesses`, `ai_skills`, `ai_guardrails`, `ai_feature_bindings`, `ai_registry_revisions` and the version counter (`[store.ts:saveAgent]` etc.).
- In-process HTTP subrequests (`[inProcessApi.ts:InProcessApiClient]`): GET plus POST/PUT/PATCH/DELETE, so subrequests can write through the target routes.
- `[seedSync.ts:syncRegistrySeeds]` writes seeded agents, harnesses, skills, bindings and guardrails, calls `syncBuiltinEvalCases` (writes `ai_eval_cases` / `obs_settings`) and deletes retired built-in agents (`RETIRED_AGENTS`).
- Process-global harness baseline registration (`[harness.ts:registerHarnessBaseline]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
