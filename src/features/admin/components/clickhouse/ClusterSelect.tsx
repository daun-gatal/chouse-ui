/**
 * ClusterSelect
 *
 * Dropdown of available ClickHouse clusters (from system.clusters) for the role
 * and user wizards. Empty value = no ON CLUSTER clause.
 */

import { useEffect, useState } from "react";
import { log } from "@/lib/log";
import { rbacClickHouseUsersApi } from "@/api/rbac";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "__none__";

interface ClusterSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ClusterSelect({ value, onChange, className }: ClusterSelectProps) {
  const [clusters, setClusters] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    rbacClickHouseUsersApi
      .getClusters()
      .then((list) => active && setClusters(list))
      .catch((error) => log.error("Failed to load clusters", error));
    return () => {
      active = false;
    };
  }, []);

  return (
    <Select value={value ? value : NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="No cluster" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No cluster (single node)</SelectItem>
        {clusters.map((c) => (
          <SelectItem key={c} value={c}>{c}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default ClusterSelect;
