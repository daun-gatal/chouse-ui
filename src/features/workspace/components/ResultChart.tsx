/**
 * The SQL workspace's Chart tab (ADR 0021 §12): draws the last result with a
 * spec suggested from its column types, editable, and pins it to a dashboard.
 */

import React, { useMemo, useState } from "react";
import { Pin } from "lucide-react";

import { PanelVisual } from "@/components/charts/PanelVisual";
import { VizSpecEditor } from "@/components/charts/VizSpecEditor";
import PermissionGuard from "@/components/common/PermissionGuard";
import { Button } from "@/components/ui/button";
import type { QueryResult } from "@/api/query";
import { PinToDashboardDialog } from "@/features/dashboards/components/PinToDashboardDialog";
import { suggestSpec } from "@/lib/viz/autodetect";
import { vizSpecProblems, type VizSpec } from "@/lib/viz/spec";
import { RBAC_PERMISSIONS } from "@/stores";

interface Props {
  result: QueryResult;
  /** The SQL that produced `result`. */
  sql: string;
}

export function ResultChart({ result, sql }: Props): React.ReactElement {
  const columns = result.meta;
  const signature = columns.map((c) => `${c.name}:${c.type}`).join(",");
  const suggested = useMemo(() => suggestSpec(columns, result.data.length), [columns, result.data.length]);
  const [edited, setEdited] = useState<{ signature: string; spec: VizSpec } | null>(null);
  // A result with different columns starts from a fresh suggestion.
  const spec = edited && edited.signature === signature ? edited.spec : suggested;
  const [pinOpen, setPinOpen] = useState(false);
  const problems = vizSpecProblems(spec);
  const data = useMemo(() => ({ columns, rows: result.data }), [columns, result.data]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-start gap-3 border-b border-ink-500 bg-ink-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <VizSpecEditor spec={spec} columns={columns} onChange={(next) => setEdited({ signature, spec: next })} />
        </div>
        <PermissionGuard requiredPermission={RBAC_PERMISSIONS.DASHBOARDS_EDIT}>
          <Button size="sm" variant="outline" onClick={() => setPinOpen(true)} disabled={problems.length > 0 || sql.trim() === ""}>
            <Pin className="mr-1.5 h-3.5 w-3.5" /> Pin to dashboard
          </Button>
        </PermissionGuard>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {problems.length > 0 ? (
          <p className="text-xs text-paper-faint">Fix the chart settings above to draw it.</p>
        ) : (
          <PanelVisual spec={spec} data={data} height={360} />
        )}
      </div>
      <PinToDashboardDialog open={pinOpen} onOpenChange={setPinOpen} sql={sql} viz={spec} />
    </div>
  );
}
