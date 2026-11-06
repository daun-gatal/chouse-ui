# assistant

## Overview

AI Governance > Assistant: the AI agent registry UI (feature bindings, agent tree, harnesses, skills, tool catalog, test console, Chobi org settings) with AI drafting, revision history and rollback, backed by `@/api/aiAgents`.

## Interface

- `[AssistantPanel.tsx:AssistantPanel]` - root view with KPIs, problems and tabs
- `[AgentEditor.tsx:AgentEditor]` / `AgentEditorTarget` - agent editing sheet
- `[RegistryViews.tsx:FeaturesView]`, `AgentsView`, `ToolsView` - registry tables
- `[HarnessesView.tsx:HarnessesView]`, `[SkillsView.tsx:SkillsView]` - harness and skill editors
- `[TestConsole.tsx:TestConsole]` - run a feature against an agent or unsaved draft
- `[ChobiSettingsView.tsx:ChobiSettingsView]`, `[ChobiAlertsSection.tsx:ChobiAlertsSection]` - org Chobi settings and Need You alerts
- `[DraftWithAi.tsx:DraftWithAiDialog]`, `useAiDraftSession`, `useSaveGuard` - AI drafting flow (drafts never save)
- `[RevisionHistory.tsx:RevisionHistory]` - revision list with restore
- `[hooks.ts:useAiRegistry]`, `useAssistantMutations`, `useRevisions`, `useModelOptions`, `useAgentTest`, `usePromptPreview`, `useDraft`, `assistantKeys`
- `[DraftWithAi.tsx:RefineWithAi]`, `AiDraftBanner`, `SectionReview`, `SectionMark`, `SaveWarning`, `DraftWithAiButton` - draft review/refine UI
- `[lib.ts:compatibleAgents]`, `agentTree`, `groupTools`, `blankAgent`, `draftWarnings`; `[shared.tsx:Field]`, `ProblemList`, `errorMessage`

## Invariants

- Management gated on `RBAC_PERMISSIONS.AI_AGENTS_MANAGE`; guardrail column needs AI_GUARDRAILS_VIEW `[AssistantPanel.tsx:AssistantPanel]` `[RegistryViews.tsx:AgentsView]`
- Built-in entities cannot be deleted; custom agents, harnesses and skills cannot be deleted while `usedBy` is non-empty `[AgentEditor.tsx:AgentEditor]` `[HarnessesView.tsx:HarnessesView]` `[SkillsView.tsx:SkillsView]`
- Feature/agent compatibility and subagent cycle prevention `[lib.ts:compatibleAgents]` `[AgentEditor.tsx:AgentEditor]`
- AI drafts with warnings need a second Save anyway click `[DraftWithAi.tsx:useSaveGuard]`; an `EVALS_REQUIRED` save error switches to the evals tab `[AgentEditor.tsx:AgentEditor]`
- Draft goal 8-4000 chars, skill reference material max 60,000 `[DraftWithAi.tsx:DraftWithAiDialog]`; refine instruction 3-2000 `[DraftWithAi.tsx:RefineWithAi]`; skills only add read-access tools `[SkillsView.tsx:SkillToolsField]`
- Need You alert delay int 0-1440, max 10 channels `[ChobiAlertsSection.tsx:ChobiAlertsSection]`

## Side Effects

- `@/api/aiAgents` registry CRUD (optimistic version), `bindFeature`, `rollbackRevision` `[hooks.ts:useAssistantMutations]`; `previewAgent` `[hooks.ts:usePromptPreview]`; `runAgentTest` `[hooks.ts:useAgentTest]`; `draftEntity` `[hooks.ts:useDraft]`; `fetchAiModels` `[hooks.ts:useModelOptions]`
- Invalidates registry/revision keys and dispatches window `ai-agents-updated` `[hooks.ts:useRefresh]`
- `updateChobiSettings` and `listChannels` `[ChobiSettingsView.tsx:ChobiSettingsView]` `[ChobiAlertsSection.tsx:ChobiAlertsSection]`
- Creates eval cases from console runs `[TestConsole.tsx:TestConsole]`; toasts throughout

## Verification

- Run: `bunx vitest run src/features/agents/assistant` (from repo root; full suite: `bunx vitest run`)
