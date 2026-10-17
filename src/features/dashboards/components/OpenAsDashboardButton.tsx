/**
 * "Open as dashboard" on a built-in view (ADR 0021 §8): copies the matching
 * template into a dashboard the user owns and opens it. Shown to users who can create dashboards.
 */

import React, { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChartColumn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { instantiateTemplate } from "@/api/dashboards";
import { RBAC_PERMISSIONS, useAuthStore, useRbacStore } from "@/stores";
import { BTN_OUTLINE } from "@/components/charts/controlStyles";

import { dashboardKeys } from "../hooks";
import { scopeForNew } from "../scope";

export function OpenAsDashboardButton({ templateId }: { templateId: string }): React.ReactElement | null {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canCreate = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.DASHBOARDS_EDIT));
  const [busy, setBusy] = useState(false);
  const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
  if (!canCreate) return null;
  const open = async (): Promise<void> => {
    setBusy(true);
    try {
      const created = await instantiateTemplate(templateId, scopeForNew(activeConnectionId));
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
