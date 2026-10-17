/**
 * "Open as dashboard" on a built-in view (ADR 0021 §8): copies the matching
 * template into a dashboard the user owns, on the active connection, and
 * opens it. Shown to users who can create dashboards.
 */

import React, { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChartColumn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { instantiateTemplate } from "@/api/dashboards";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { BTN_OUTLINE } from "@/components/charts/controlStyles";

import { dashboardKeys } from "../hooks";

export function OpenAsDashboardButton({ templateId, connectionId }: { templateId: string; connectionId: string | null }): React.ReactElement | null {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canCreate = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.DASHBOARDS_EDIT));
  const [busy, setBusy] = useState(false);
  if (!canCreate) return null;
  const open = async (): Promise<void> => {
    setBusy(true);
    try {
      const created = await instantiateTemplate(templateId, connectionId);
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.list() });
      navigate(`/dashboards/${created.dashboard.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" className={BTN_OUTLINE} onClick={() => void open()} disabled={busy}>
      <ChartColumn className="mr-1.5 h-3.5 w-3.5" /> Open as dashboard
    </Button>
  );
}
