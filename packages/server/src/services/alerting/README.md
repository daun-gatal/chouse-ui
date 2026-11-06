# Alerting

## Overview
The normalized alerting model: notification channels, rules, rule-channel links and alert events, with AES-256-GCM encryption of channel secrets, plus channel-usage counts and the shared alerting read-tool schema. Delivery lives in [notify](./notify/README.md).

## Interface
- Channels: `[store.ts:listChannels]`, `[store.ts:getChannel]`, `[store.ts:createChannel]`, `[store.ts:updateChannel]`, `[store.ts:upsertChannel]`, `[store.ts:patchChannelConfig]`, `[store.ts:setChannelEnabled]`, `[store.ts:deleteChannel]`, `[store.ts:decryptChannelConfig]`, `[store.ts:maskChannelConfig]`.
- Rules: `[store.ts:listRules]`, `[store.ts:getRule]`, `[store.ts:createRule]`, `[store.ts:upsertRule]`, `[store.ts:deleteRule]`, `[store.ts:setRuleChannels]`, `[store.ts:linkChannel]`, `[store.ts:unlinkChannel]`.
- Events: `[store.ts:recordEvent]`, `[store.ts:listEvents]`, `[store.ts:searchEvents]`, `[store.ts:clearEvents]`.
- `[types.ts:CHANNEL_TYPES]`, `[types.ts:ALERT_SOURCE_TYPES]`, `[types.ts:ALERT_SEVERITIES]`, `[types.ts:LEGACY_FLEET_RULE_ID]`.
- `[usage.ts:channelUsage]`, `[usage.ts:totalUsage]`, `[usage.ts:waitingRequests]`, `[usage.ts:firingNow]`.
- `[toolSchema.ts:ALERTING_SCHEMA]`, `[toolSchema.ts:alertingRequest]`, `[toolSchema.ts:ALERTING_KINDS]`.
- Subpackage: [notify](./notify/README.md).

## Invariants
- Secret-bearing channel config keys are encrypted before persist and masked on read (`[store.ts:secretKeysForMode]`, `[store.ts:maskChannelConfig]`).
- Channel usage reports counts only, never names of things the viewer may not see (`[usage.ts:channelUsage]` header).
- The assistant's `list_alerting` and MCP `list_alerts` share the same argument schema (`[toolSchema.ts:ALERTING_SCHEMA]`).

## Side Effects
- Writes `notification_channels`, `alert_rules`, `alert_rule_channels`, `alert_events` (`[store.ts:createChannel]`, `[store.ts:upsertRule]`, `[store.ts:linkChannel]`, `[store.ts:recordEvent]`).
- Deletes `alert_rules` / `alert_rule_channels` rows (`[store.ts:deleteRule]`) and `alert_events` rows, all or up to a cutoff (`[store.ts:clearEvents]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
