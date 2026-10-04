/**
 * Doctor report as an investigation (ADR 0016 §7, §8): the report's shared
 * notebook and the fixes proposed from it. Historical reports were migrated
 * into notebooks, so every report has one.
 */

import type { ReactElement } from "react";

import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { useAttachedNotebook } from "./hooks";
import { NotebookPanel } from "./NotebookPanel";
import { RemediationPanel } from "./RemediationPanel";

export function DoctorInvestigation({ reportId }: { reportId: string }): ReactElement {
  const { hasAnyPermission } = useRbacStore();
  const notebook = useAttachedNotebook("doctor_report", reportId, "Doctor report");
  const canRemediate = hasAnyPermission([RBAC_PERMISSIONS.REMEDIATION_PROPOSE, RBAC_PERMISSIONS.REMEDIATION_APPROVE, RBAC_PERMISSIONS.REMEDIATION_APPROVE_HIGH]);
  return (
    <div className="mt-6 space-y-4" data-onboarding-id="doctor-investigation">
      <NotebookPanel kind="doctor_report" attachedRef={reportId} title="Doctor report" />
      {canRemediate && notebook.data && <RemediationPanel context={{ notebookId: notebook.data.notebook.id }} title="Fixes from this report" />}
    </div>
  );
}
