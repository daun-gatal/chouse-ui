type: minor

### Added
- **AI Agent Platform V1** — introduce the first policy-driven AI platform layer for chouse-ui.

  This V1 keeps the existing `ToolLoopAgent` capability architecture, but routes capabilities through deployment policies instead of treating every configured model as globally equivalent.

  Included in V1:
  - Add `rbac_ai_config_policies` for capability enablement, priority, tuning, guardrails, provider options, and fallback deployment IDs.
  - Route AI capabilities by explicit model, policy priority, default deployment fallback, and configured fallback deployments on runtime/provider failure.
  - Prefer AI SDK-native `ToolLoopAgent.generate()` with `Output.object({ schema })` for structured capabilities, while retaining the legacy structured-output fallback path for provider compatibility.
  - Pass SDK-native timeout, abort signal, provider options, usage, finish reason, and step/tool metadata through the shared AI engine.
  - Harden AI ClickHouse tools with shared identifier/string escaping and fix chart execution to run cleaned SQL after trailing `FORMAT` removal.
  - Add policy observability logging for capability, config, model, policy, output mode, usage, tool calls, finish reason, and fallback usage without storing secrets or query result payloads.
  - Extend AI Admin with a dedicated **Policies** tab and wizard-style flow for choosing deployment, capabilities, routing, limits, fallback deployments, and advanced provider options.
  - Extend AI model/capability APIs so callers can request eligible deployments for a capability and inspect capability policy coverage.

  Follow-up notes:
  - This is V1, not a provider expansion. Existing provider types remain unchanged.
  - The Policies tab is intentionally centralized; policy editing is no longer hidden behind individual deployment rows.
  - The deployment list in the Policies tab is scrollable today. If operators manage many deployments, the next UX pass should add search/filtering without changing policy semantics.

### Fixed
- **Ask AI expand modes** — keep message history accessible in all three Ask AI window widths.

  Compact and standard modes now open thread history as an overlay drawer, while wide mode keeps the split-pane sidebar. The expand control now cycles explicitly through compact, standard, and wide modes without making history unreachable in the first two modes.
