# fleet/components

## Overview

Components for the /fleet page and ChouseD doctor reports: node cards and rows, inventory strip, trends, exceptions, alert bell/toast/dock, doctor report/history views and the doctor schedule dialog. No barrel; mostly default exports.

## Interface

- `[FleetCard.tsx:default FleetCard]` - per-connection card
- `[FleetRow.tsx:default FleetRow]` / `FleetListHeader` - compact snapshot rows
- `[FleetAlertsBell.tsx:default FleetAlertsBell]`, `[FleetAlertsDockItem.tsx:default FleetAlertsDockItem]`, `[fleetAlertToast.tsx:fireAlertToast]` - fleet alerting UI
- `[FleetInventoryStrip.tsx:default FleetInventoryStrip]`, `[FleetTrendPanel.tsx:default FleetTrendPanel]`, `[FleetExceptionsFeed.tsx:default FleetExceptionsFeed]`
- `[DoctorReportView.tsx:default DoctorReportView]`, `HeavyQueryCard`, `OptimizationAnalysis`
- `[DoctorHistoryList.tsx:default DoctorHistoryList]`, `[DoctorScheduleDialog.tsx:default DoctorScheduleDialog]`
- `[doctorShared.ts:DOCTOR_STATUS]`, `STATUS_RANK`, `timeAgo`, `formatBytes`; `[FleetVersion.tsx:FleetVersion]` / `upgradesPath`; `[Sparkline.tsx:default Sparkline]`

## Invariants

- Cards use the snapshot only when `isSnapshotFresh`, otherwise live hooks `[FleetCard.tsx:FleetCard]`
- Consecutive summary errors drive the down status `[FleetCard.tsx:FleetCard]`
- Alert thresholds rounded and clamped per rule `[FleetAlertsBell.tsx:RuleRow]`
- Only active connections feed alerts and schedule scope; day-of-month 1-28 `[FleetAlertsDockItem.tsx:FleetAlertsDockItem]` `[DoctorScheduleDialog.tsx:DoctorScheduleDialog]`
- Doctor nodes sorted worst-first by `STATUS_RANK` `[DoctorReportView.tsx:DoctorReportView]`
- No permission gating in this folder

## Side Effects

- `activateConnection` then `window.location.assign` to monitoring pages `[FleetCard.tsx:handleOpen]` `[FleetRow.tsx:handleOpen]`
- Polling via `@/hooks/useFleetMetrics` (snapshots 10s, history and exceptions 30s) `[FleetAlertsDockItem.tsx:FleetAlertsDockItem]` `[FleetTrendPanel.tsx:FleetTrendPanel]`
- `fetchDoctorSchedule`, `fetchDoctorModels`, `updateDoctorSchedule` with invalidation `[DoctorScheduleDialog.tsx:DoctorScheduleDialog]`
- 60s custom alert toasts deduped by id `[fleetAlertToast.tsx:fireAlertToast]`; timers and clipboard `[DoctorReportView.tsx:CopyButton]`

## Verification

- Run: `bunx vitest run src/features/fleet/components` (from repo root; full suite: `bunx vitest run`)
