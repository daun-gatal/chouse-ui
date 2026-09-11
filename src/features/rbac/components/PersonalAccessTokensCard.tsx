import React, { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import ConfirmationDialog from "@/components/common/ConfirmationDialog";
import { MONO_FAINT, MONO_LABEL, SettingCard, StatusFooter } from "@/pages/Preferences";
import { rbacPatApi } from "@/api/rbac";
import type { PatToken } from "@/api/rbac";
import { useRbacStore } from "@/stores";
import { log } from "@/lib/log";
import { cn } from "@/lib/utils";

const PAT_QUERY_KEY = ["pat-tokens"];

const EXPIRY_PRESETS = [
  { id: "none", label: "No expiry" },
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "60", label: "60 days" },
  { id: "90", label: "90 days" },
  { id: "custom", label: "Custom…" },
] as const;

type ExpiryPreset = (typeof EXPIRY_PRESETS)[number]["id"];

const DAY_MS = 86_400_000;

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface CreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  availablePermissions: string[];
  onCreated: (rawToken: string, name: string) => void;
}

const CreatePatDialog: React.FC<CreateDialogProps> = ({
  isOpen,
  onClose,
  availablePermissions,
  onCreated,
}) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>("none");
  const [expiryDate, setExpiryDate] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(availablePermissions);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    const cats: Record<string, string[]> = {};
    for (const perm of availablePermissions) {
      const [category] = perm.split(":");
      if (!cats[category]) cats[category] = [];
      cats[category].push(perm);
    }
    return cats;
  }, [availablePermissions]);

  const categories = Object.keys(grouped);
  const allCollapsed = categories.length > 0 && categories.every((c) => collapsed[c]);
  const allSelected =
    availablePermissions.length > 0 && selectedScopes.length === availablePermissions.length;

  const createMutation = useMutation({
    mutationFn: async (): Promise<{ rawToken: string; name: string }> => {
      const trimmed = name.trim();
      let expiresAt: string | null = null;
      if (expiryPreset === "custom") {
        expiresAt = new Date(`${expiryDate}T23:59:59`).toISOString();
      } else if (expiryPreset !== "none") {
        expiresAt = new Date(Date.now() + Number(expiryPreset) * DAY_MS).toISOString();
      }
      const created = await rbacPatApi.create({
        name: trimmed,
        expiresAt,
        scopes: selectedScopes,
      });
      return { rawToken: created.rawToken, name: created.token.name };
    },
    onSuccess: ({ rawToken, name: createdName }) => {
      void queryClient.invalidateQueries({ queryKey: PAT_QUERY_KEY });
      setName("");
      setExpiryPreset("none");
      setExpiryDate("");
      setSelectedScopes(availablePermissions);
      onCreated(rawToken, createdName);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      log.error("[PersonalAccessTokens] Failed to create token", { message });
      toast.error(`Failed to create token: ${message}`);
    },
  });

  const toggleScope = (scope: string): void => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const toggleCategory = (category: string): void => {
    const perms = grouped[category];
    setSelectedScopes((prev) =>
      perms.every((p) => prev.includes(p))
        ? prev.filter((s) => !perms.includes(s))
        : [...new Set([...prev, ...perms])],
    );
  };

  const toggleCategoryCollapsed = (category: string): void => {
    setCollapsed((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  const setAllCollapsed = (value: boolean): void => {
    setCollapsed(Object.fromEntries(categories.map((c) => [c, value])));
  };

  const canSubmit =
    name.trim().length > 0 &&
    selectedScopes.length > 0 &&
    (expiryPreset !== "custom" || expiryDate !== "") &&
    !createMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New personal access token</DialogTitle>
          <DialogDescription>
            For connecting external apps. Scopes can only narrow what you can
            already do — never widen it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pat-name">Name</Label>
            <Input
              id="pat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. nightly-report"
              maxLength={64}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Expiry</Label>
            <div className="flex flex-wrap gap-2">
              {EXPIRY_PRESETS.map((preset) => {
                const active = expiryPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setExpiryPreset(preset.id)}
                    aria-pressed={active}
                    className={cn(
                      "rounded-xs border px-3 py-1.5 font-mono text-[12px] transition-colors",
                      active
                        ? "border-brand bg-brand/[0.08] text-brand"
                        : "border-ink-500 bg-ink-200 text-paper-muted hover:border-ink-700 hover:text-paper",
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            {expiryPreset === "custom" && (
              <Input
                type="date"
                value={expiryDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setExpiryDate(e.target.value)}
                aria-label="Custom expiry date"
              />
            )}
            {expiryPreset === "none" && (
              <p className={MONO_FAINT}>The token never expires. You can revoke it anytime.</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={MONO_LABEL}>
                Scopes · {selectedScopes.length}/{availablePermissions.length} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedScopes(allSelected ? [] : [...availablePermissions])}
                  className="font-mono text-[11px] uppercase tracking-[0.14em] text-brand hover:underline"
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
                <span className="text-paper-faint" aria-hidden>|</span>
                <button
                  type="button"
                  onClick={() => setAllCollapsed(!allCollapsed)}
                  className="font-mono text-[11px] uppercase tracking-[0.14em] text-brand hover:underline"
                >
                  {allCollapsed ? "Expand all" : "Collapse all"}
                </button>
              </div>
            </div>
            {categories.map((category) => {
              const perms = grouped[category];
              const selectedCount = perms.filter((p) => selectedScopes.includes(p)).length;
              const isCollapsed = collapsed[category] === true;
              return (
                <div
                  key={category}
                  className="rounded-xs border border-ink-500 bg-ink-200 p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => toggleCategory(category)}
                      className={cn(MONO_LABEL, "hover:text-paper")}
                      title={selectedCount === perms.length ? `Deselect ${category}` : `Select ${category}`}
                    >
                      {category} — {selectedCount}/{perms.length}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleCategoryCollapsed(category)}
                      className="rounded-xs p-1 text-paper-dim transition-colors hover:text-paper"
                      aria-label={isCollapsed ? `Expand ${category}` : `Collapse ${category}`}
                      aria-expanded={!isCollapsed}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  <AnimatePresence initial={false}>
                    {!isCollapsed && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <div className="flex flex-col gap-1.5 pt-2">
                          {perms.map((perm) => (
                            <label key={perm} className="flex cursor-pointer items-center gap-2">
                              <Checkbox
                                checked={selectedScopes.includes(perm)}
                                onCheckedChange={() => toggleScope(perm)}
                              />
                              <span className="font-mono text-[12px] text-paper-muted">{perm}</span>
                            </label>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => createMutation.mutate()}>
            {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface SecretDialogProps {
  rawToken: string | null;
  name: string;
  onClose: () => void;
}

const OneTimeSecretDialog: React.FC<SecretDialogProps> = ({ rawToken, name, onClose }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    if (!rawToken) return;
    try {
      await navigator.clipboard.writeText(rawToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      log.error("[PersonalAccessTokens] Failed to copy token", {
        message: error instanceof Error ? error.message : String(error) },
      );
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <Dialog open={rawToken !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Token created — copy it now</DialogTitle>
          <DialogDescription>
            “{name}” will never be shown again. Store it somewhere safe — for
            example as an environment variable in your external app.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-xs border border-brand/40 bg-brand/5 px-3 py-2.5">
          <span className="flex-1 truncate font-mono text-[12px] text-paper">{rawToken}</span>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="rounded-xs p-1 text-paper-dim transition-colors hover:text-paper"
            title="Copy to clipboard"
            aria-label="Copy token"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const PersonalAccessTokensCard: React.FC<{ className?: string }> = ({ className }) => {
  const queryClient = useQueryClient();
  const { user } = useRbacStore();
  const [showCreate, setShowCreate] = useState(false);
  const [secret, setSecret] = useState<{ rawToken: string; name: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<PatToken | null>(null);
  const [rotateTarget, setRotateTarget] = useState<PatToken | null>(null);

  const availablePermissions = useMemo(() => user?.permissions ?? [], [user?.permissions]);

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: PAT_QUERY_KEY,
    queryFn: () => rbacPatApi.list(),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: PAT_QUERY_KEY });
  };

  const revokeMutation = useMutation({
    mutationFn: (id: string) => rbacPatApi.revoke(id),
    onSuccess: () => {
      toast.success("Token revoked");
      setRevokeTarget(null);
      invalidate();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      log.error("[PersonalAccessTokens] Failed to revoke token", { message });
      toast.error(`Failed to revoke token: ${message}`);
    },
  });

  const rotateMutation = useMutation({
    mutationFn: (id: string) => rbacPatApi.rotate(id),
    onSuccess: (created) => {
      setRotateTarget(null);
      invalidate();
      setSecret({ rawToken: created.rawToken, name: created.token.name });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      log.error("[PersonalAccessTokens] Failed to rotate token", { message });
      toast.error(`Failed to rotate token: ${message}`);
    },
  });

  return (
    <SettingCard
      title="Personal access tokens"
      description="Machine credentials for external apps"
      icon={KeyRound}
      delay={0.45}
      className={className ?? "md:col-span-3"}
      onboardingId="preferences-pat"
    >
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className={MONO_FAINT}>Tokens inherit your live permissions</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCreate(true)}
            disabled={availablePermissions.length === 0}
            className="h-8 gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em]"
          >
            <Plus className="h-3.5 w-3.5" />
            New token
          </Button>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : tokens.length === 0 ? (
          <div className="rounded-xs border border-ink-500 bg-ink-200 px-4 py-8 text-center">
            <p className={cn(MONO_LABEL, "tracking-[0.18em]")}>No tokens yet</p>
            <p className={cn("mt-1", MONO_FAINT)}>Create one to connect an external app</p>
          </div>
        ) : (
          <div className="custom-scrollbar flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
            {tokens.map((token) => (
              <div
                key={token.id}
                className="flex items-center justify-between gap-3 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium tracking-tight text-paper">
                    {token.name}
                  </span>
                  <span className={MONO_FAINT}>
                    ch_pat_{token.keyPrefix}… ·{" "}
                    {token.scopes.length === 0 ? "full access" : `${token.scopes.length} scopes`} ·{" "}
                    expires {formatDate(token.expiresAt)} · last used{" "}
                    {formatDate(token.lastUsedAt)}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setRotateTarget(token)}
                    className="rounded-xs p-1.5 text-paper-dim transition-colors hover:bg-ink-100 hover:text-paper"
                    title={`Rotate ${token.name} (new secret, same settings)`}
                    aria-label={`Rotate ${token.name}`}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRevokeTarget(token)}
                    className="rounded-xs p-1.5 text-paper-dim transition-colors hover:bg-red-950/40 hover:text-red-300"
                    title={`Revoke ${token.name}`}
                    aria-label={`Revoke ${token.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-auto">
          <StatusFooter label="Machine auth" meta={`${tokens.length} active`} tone="emerald" />
        </div>
      </div>

      {showCreate && (
        <CreatePatDialog
          isOpen={showCreate}
          onClose={() => setShowCreate(false)}
          availablePermissions={availablePermissions}
          onCreated={(rawToken, createdName) => {
            setShowCreate(false);
            setSecret({ rawToken, name: createdName });
          }}
        />
      )}

      <OneTimeSecretDialog
        rawToken={secret?.rawToken ?? null}
        name={secret?.name ?? ""}
        onClose={() => setSecret(null)}
      />

      <ConfirmationDialog
        isOpen={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => { if (revokeTarget) revokeMutation.mutate(revokeTarget.id); }}
        title="Revoke token"
        description={`“${revokeTarget?.name}” will stop working immediately and disappear from this list. Connected apps using it will lose access. This cannot be undone.`}
        confirmText={revokeMutation.isPending ? "Revoking..." : "Revoke"}
        cancelText="Cancel"
        variant="danger"
      />

      <ConfirmationDialog
        isOpen={rotateTarget !== null}
        onClose={() => setRotateTarget(null)}
        onConfirm={() => { if (rotateTarget) rotateMutation.mutate(rotateTarget.id); }}
        title="Rotate token"
        description={`“${rotateTarget?.name}” gets a new secret with the same settings. The old secret stops working immediately — update your connected apps, then copy the new secret shown next.`}
        confirmText={rotateMutation.isPending ? "Rotating..." : "Rotate"}
        cancelText="Cancel"
        variant="danger"
      />
    </SettingCard>
  );
};
