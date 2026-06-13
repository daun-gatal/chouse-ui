/**
 * Admin SSO Settings & Provider Management
 *
 * Admin UI for global SSO settings (enabled, base URL, default role, auto-link)
 * and CRUD of OIDC/OAuth2 providers, coexisting with read-only env/YAML config
 * providers (source: 'config').
 *
 * - Settings panel: a compact form, edits gated on sso:manage.
 * - Providers list: merged env + DB providers; env providers are read-only.
 * - Add/Edit provider: a 3-step modal wizard mirroring ConnectionManagement.
 *   Step 3 runs a live test; Save requires a passing test (with "Save anyway").
 * - Delete: an AlertDialog (DataAccessPolicies style) that warns about forced
 *   unlink of linked users.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  KeyRound,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Save,
  Check,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Play,
  ArrowLeft,
  ArrowRight,
  Lock,
  ChevronsUpDown,
  X,
  MoreVertical,
  Power,
  PowerOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { log } from "@/lib/log";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  rbacSsoAdminApi,
  rbacRolesApi,
  type RbacRole,
  type SsoAdminProvider,
  type SsoTestResult,
} from "@/api/rbac";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";

// Shared editorial chrome classes (match ConnectionManagement / DataAccessPolicies).
const LABEL_CLASS = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim";
const INPUT_CLASS =
  "h-9 rounded-xs border-ink-500 bg-ink-200 font-mono text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0";
const HELP_CLASS = "text-[11px] text-paper-faint";

const SLUG_RE = /^[a-z0-9_-]+$/;
const SECRET_PLACEHOLDER = "•••• set";

type ProviderType = "oidc" | "oauth2";

/** True only for a syntactically valid absolute http(s) URL. */
function isValidUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** True when a field has content but is not a valid URL (for inline errors). */
function urlInvalid(value: string): boolean {
  return value.trim().length > 0 && !isValidUrl(value);
}

// ---- Role mapping (claim value → role) ----
interface RoleMappingRow {
  value: string; // the IdP group / claim value
  role: string; // local role name
}

/** Parse the compact "value:role,value2:role2" string into editor rows. */
function parseRoleMapping(s: string | null | undefined): RoleMappingRow[] {
  if (!s) return [];
  const rows: RoleMappingRow[] = [];
  for (const pair of s.split(",")) {
    const t = pair.trim();
    const idx = t.indexOf(":");
    if (idx <= 0 || idx === t.length - 1) continue;
    rows.push({ value: t.slice(0, idx).trim(), role: t.slice(idx + 1).trim() });
  }
  return rows;
}

/** Serialize editor rows back to the compact "value:role,..." string. */
function serializeRoleMapping(rows: RoleMappingRow[]): string {
  return rows
    .filter((r) => r.value.trim() && r.role.trim())
    .map((r) => `${r.value.trim()}:${r.role.trim()}`)
    .join(",");
}

// ============================================
// Searchable role picker (Popover + Command combobox)
// ============================================

function RoleCombobox({
  value,
  roles,
  onChange,
  disabled,
}: {
  value: string;
  roles: RbacRole[];
  onChange: (roleName: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = roles.find((r) => r.name === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn(INPUT_CLASS, "w-40 shrink-0 justify-between px-2 font-normal")}
        >
          <span className={cn("truncate", !selected && !value && "text-paper-faint")}>
            {selected ? selected.displayName || selected.name : value || "Select role"}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-paper-faint" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 rounded-xs border-ink-500 bg-ink-100 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search roles…" className="text-[12px]" />
          <CommandList>
            <CommandEmpty className="py-3 text-center text-[12px] text-paper-faint">No role found.</CommandEmpty>
            <CommandGroup>
              {roles.map((r) => (
                <CommandItem
                  key={r.id}
                  value={r.name}
                  onSelect={() => {
                    onChange(r.name);
                    setOpen(false);
                  }}
                  className="text-[12px]"
                >
                  <Check className={cn("mr-2 h-3.5 w-3.5", value === r.name ? "opacity-100" : "opacity-0")} />
                  {r.displayName || r.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ============================================
// Role-mapping rows editor (data-access-rules style)
// ============================================

function RoleMappingEditor({
  rows,
  roles,
  onChange,
  disabled,
}: {
  rows: RoleMappingRow[];
  roles: RbacRole[];
  onChange: (rows: RoleMappingRow[]) => void;
  disabled?: boolean;
}) {
  const updateAt = (i: number, patch: Partial<RoleMappingRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeAt = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { value: "", role: roles[0]?.name ?? "" }]);

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className={HELP_CLASS}>No mappings — users get the default role on first sign-in.</p>
      ) : (
        <>
          <div className="flex items-center gap-1.5 px-0.5">
            <span className={cn(LABEL_CLASS, "w-40 shrink-0")}>Role</span>
            <span className="w-3" />
            <span className={cn(LABEL_CLASS, "flex-1")}>When claim value is</span>
            <span className="w-7" />
          </div>
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <RoleCombobox
                value={row.role}
                roles={roles}
                onChange={(role) => updateAt(i, { role })}
                disabled={disabled}
              />
              <span className="w-3 text-center text-paper-faint">←</span>
              <Input
                value={row.value}
                onChange={(e) => updateAt(i, { value: e.target.value })}
                placeholder="okta group / claim value"
                className={cn(INPUT_CLASS, "flex-1")}
                disabled={disabled}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => removeAt(i)}
                disabled={disabled}
                className="h-7 w-7 shrink-0 rounded-xs text-red-400 hover:bg-red-950/40 hover:text-red-300"
                aria-label="Remove mapping"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </>
      )}
      {!disabled && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={add}
          className="h-7 gap-1 rounded-xs px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim hover:bg-ink-100 hover:text-paper"
        >
          <Plus className="h-3 w-3" /> Add role mapping
        </Button>
      )}
    </div>
  );
}

// ============================================
// Settings panel
// ============================================

interface SettingsForm {
  enabled: boolean;
  baseUrl: string;
  defaultRole: string;
  autoLinkByEmail: boolean;
}

function SettingsPanel({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ["sso-settings"],
    queryFn: () => rbacSsoAdminApi.getSettings(),
  });
  const { data: roles } = useQuery({
    queryKey: ["rbac-roles"],
    queryFn: () => rbacRolesApi.list(),
  });
  // SSO settings are meaningless with zero providers — block editing until one exists.
  const { data: providers } = useQuery({
    queryKey: ["sso-admin-providers"],
    queryFn: () => rbacSsoAdminApi.getProviders(),
  });
  const hasProviders = (providers?.length ?? 0) > 0;
  // Settings defined by env/YAML config are read-only (mirrors config providers).
  const isConfigSourced = settings?.source === "config";
  const canEdit = canManage && hasProviders && !isConfigSourced;

  const [form, setForm] = useState<SettingsForm>({
    enabled: false,
    baseUrl: "",
    defaultRole: "viewer",
    autoLinkByEmail: true,
  });

  // Hydrate the form once settings arrive (and on refetch).
  useEffect(() => {
    if (!settings) return;
    setForm({
      enabled: settings.enabled,
      baseUrl: settings.baseUrl ?? "",
      defaultRole: settings.defaultRole,
      autoLinkByEmail: settings.autoLinkByEmail,
    });
  }, [settings]);

  const redirectUri = useMemo(() => {
    const base = form.baseUrl.trim().replace(/\/$/, "");
    return base ? `${base}/auth/sso/callback` : "<base URL>/auth/sso/callback";
  }, [form.baseUrl]);

  const saveMutation = useMutation({
    mutationFn: () =>
      rbacSsoAdminApi.updateSettings({
        enabled: form.enabled,
        baseUrl: form.baseUrl.trim() ? form.baseUrl.trim() : null,
        defaultRole: form.defaultRole,
        autoLinkByEmail: form.autoLinkByEmail,
      }),
    onSuccess: () => {
      toast.success("SSO settings saved");
      queryClient.invalidateQueries({ queryKey: ["sso-settings"] });
    },
    onError: (error: Error) => {
      log.error("Failed to save SSO settings", error);
      toast.error(`Failed to save SSO settings: ${error.message}`);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-xs border border-ink-500 bg-ink-100 py-10">
        <Loader2 className="h-5 w-5 animate-spin text-paper-dim" />
      </div>
    );
  }

  return (
    <div className="rounded-xs border border-ink-500 bg-ink-100">
      <div className="flex items-center gap-2 border-b border-ink-500 px-4 py-3">
        <KeyRound className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
        <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper">Global settings</h3>
        {settings && (
          <span
            className={cn(
              "ml-auto inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]",
              isConfigSourced
                ? "border-amber-900/60 bg-amber-950/30 text-amber-200"
                : "border-ink-500 bg-ink-200 text-paper-faint",
            )}
          >
            {isConfigSourced && <Lock className="h-2.5 w-2.5" />}
            {isConfigSourced ? "from config · read-only" : `source: ${settings.source}`}
          </span>
        )}
      </div>

      <div className="space-y-4 p-4">
        {/* Enabled */}
        <div className="flex items-center justify-between gap-3 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5">
          <div className="flex flex-col gap-0.5">
            <Label className="text-[13px] font-medium text-paper">SSO enabled</Label>
            <span className={HELP_CLASS}>Allow users to sign in via configured providers.</span>
          </div>
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            disabled={!canEdit}
          />
        </div>

        {/* Disabled-but-configured notice: providers exist but SSO is off. */}
        {hasProviders && !form.enabled && (
          <div className="flex items-center gap-2 rounded-xs border border-amber-900/60 bg-amber-950/30 px-3 py-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-300" />
            <p className="text-[12px] text-amber-200">
              SSO is disabled — the login page won't show provider buttons. Turn it on to let users sign in.
            </p>
          </div>
        )}

        {/* Base URL + derived redirect URI */}
        <div className="space-y-1.5">
          <Label className={LABEL_CLASS}>Base URL</Label>
          <Input
            value={form.baseUrl}
            onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
            placeholder="https://chouse.example.com"
            className={cn(INPUT_CLASS, urlInvalid(form.baseUrl) && "border-red-500/60")}
            disabled={!canEdit}
          />
          {urlInvalid(form.baseUrl) ? (
            <p className="text-[11px] text-red-300">Enter a valid URL (https://…).</p>
          ) : (
            <p className={HELP_CLASS}>
              Register this redirect URI with your provider:{" "}
              <code className="font-mono text-paper-muted">{redirectUri}</code>
            </p>
          )}
        </div>

        {/* Default role */}
        <div className="space-y-1.5">
          <Label className={LABEL_CLASS}>Default role</Label>
          <Select
            value={form.defaultRole}
            onValueChange={(v) => setForm((f) => ({ ...f, defaultRole: v }))}
            disabled={!canEdit}
          >
            <SelectTrigger className={INPUT_CLASS}>
              <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent>
              {(roles ?? []).map((role) => (
                <SelectItem key={role.id} value={role.name}>
                  {role.displayName || role.name}
                </SelectItem>
              ))}
              {/* Fallback so the current value is always selectable even if roles
                  haven't loaded or the value is a non-listed slug. */}
              {!(roles ?? []).some((r) => r.name === form.defaultRole) && form.defaultRole && (
                <SelectItem value={form.defaultRole}>{form.defaultRole}</SelectItem>
              )}
            </SelectContent>
          </Select>
          <p className={HELP_CLASS}>Role granted to users on their first SSO sign-in.</p>
        </div>

        {/* Auto-link by email */}
        <div className="flex items-center justify-between gap-3 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5">
          <div className="flex flex-col gap-0.5">
            <Label className="text-[13px] font-medium text-paper">Auto-link by email</Label>
            <span className={HELP_CLASS}>
              Link an SSO sign-in to an existing local user with a matching email.
            </span>
          </div>
          <Switch
            checked={form.autoLinkByEmail}
            onCheckedChange={(v) => setForm((f) => ({ ...f, autoLinkByEmail: v }))}
            disabled={!canEdit}
          />
        </div>

        {canManage && !hasProviders && (
          <div className="flex items-center gap-2 rounded-xs border border-amber-900/60 bg-amber-950/30 px-3 py-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-300" />
            <p className="text-[12px] text-amber-200">
              Add at least one provider below before configuring global SSO settings.
            </p>
          </div>
        )}

        {canEdit && (
          <div className="flex justify-end border-t border-ink-500 pt-4">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || urlInvalid(form.baseUrl)}
              className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save settings
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Provider wizard
// ============================================

interface ProviderDraft {
  id: string;
  type: ProviderType;
  displayName: string;
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  // endpoints / mapping
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  claimMapping: string;
  scopes: string;
  roleMappingClaim: string;
  roleMappingRows: RoleMappingRow[];
}

function emptyDraft(): ProviderDraft {
  return {
    id: "",
    type: "oidc",
    displayName: "",
    enabled: true,
    clientId: "",
    clientSecret: "",
    issuer: "",
    authorizationEndpoint: "",
    tokenEndpoint: "",
    userinfoEndpoint: "",
    claimMapping: "",
    scopes: "openid profile email",
    roleMappingClaim: "",
    roleMappingRows: [],
  };
}

function draftFromProvider(p: SsoAdminProvider): ProviderDraft {
  return {
    id: p.id,
    type: p.type,
    displayName: p.displayName,
    enabled: p.enabled,
    clientId: p.clientId ?? "",
    clientSecret: "",
    issuer: p.issuer ?? "",
    authorizationEndpoint: p.authorizationEndpoint ?? "",
    tokenEndpoint: p.tokenEndpoint ?? "",
    userinfoEndpoint: p.userinfoEndpoint ?? "",
    claimMapping: p.claimMapping ?? "",
    scopes: p.scopes ?? "openid profile email",
    roleMappingClaim: p.roleMappingClaim ?? "",
    roleMappingRows: parseRoleMapping(p.roleMapping),
  };
}

interface ProviderWizardProps {
  open: boolean;
  onClose: () => void;
  editing: SsoAdminProvider | null;
}

const STEP_LABELS = ["Identity", "Endpoints", "Test & save"];

function ProviderWizard({ open, onClose, editing }: ProviderWizardProps) {
  const queryClient = useQueryClient();
  const isEditing = !!editing;
  const { data: roles } = useQuery({
    queryKey: ["rbac-roles"],
    queryFn: () => rbacRolesApi.list(),
  });

  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<ProviderDraft>(emptyDraft());
  const [testResult, setTestResult] = useState<SsoTestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [saveAnyway, setSaveAnyway] = useState(false);

  // Reset state whenever the dialog opens or the target provider changes.
  useEffect(() => {
    if (!open) return;
    setDraft(editing ? draftFromProvider(editing) : emptyDraft());
    setStep(1);
    setTestResult(null);
    setSaveAnyway(false);
  }, [open, editing]);

  const update = (patch: Partial<ProviderDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    // Any change after a test invalidates the result.
    setTestResult(null);
    setSaveAnyway(false);
  };

  const secretChanged = draft.clientSecret.trim().length > 0;
  // On create the secret is required; on edit it may be left untouched.
  const secretOk = isEditing ? (editing?.hasSecret ?? false) || secretChanged : secretChanged;

  const step1Valid =
    SLUG_RE.test(draft.id) &&
    draft.displayName.trim().length > 0 &&
    draft.clientId.trim().length > 0 &&
    secretOk;

  const step2Valid =
    draft.scopes.trim().length > 0 &&
    (draft.type === "oidc"
      ? isValidUrl(draft.issuer)
      : isValidUrl(draft.authorizationEndpoint) &&
        isValidUrl(draft.tokenEndpoint) &&
        isValidUrl(draft.userinfoEndpoint));

  // Build the payload sent to create/update. Secret only included when typed.
  const buildPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      type: draft.type,
      displayName: draft.displayName.trim(),
      enabled: draft.enabled,
      clientId: draft.clientId.trim(),
      scopes: draft.scopes.trim(),
    };
    if (!isEditing) payload.id = draft.id.trim();
    if (secretChanged) payload.clientSecret = draft.clientSecret;
    if (draft.type === "oidc") {
      payload.issuer = draft.issuer.trim();
    } else {
      payload.authorizationEndpoint = draft.authorizationEndpoint.trim();
      payload.tokenEndpoint = draft.tokenEndpoint.trim();
      payload.userinfoEndpoint = draft.userinfoEndpoint.trim();
      if (draft.claimMapping.trim()) payload.claimMapping = draft.claimMapping.trim();
    }
    if (draft.roleMappingClaim.trim()) payload.roleMappingClaim = draft.roleMappingClaim.trim();
    const roleMapping = serializeRoleMapping(draft.roleMappingRows);
    if (roleMapping) payload.roleMapping = roleMapping;
    return payload;
  };

  // The test needs a concrete secret: either a freshly-typed one, or — when
  // editing a provider that already has a stored secret — the server falls back
  // to it (we pass the provider id below).
  const hasStoredSecret = isEditing && (editing?.hasSecret ?? false);
  const canTest = step2Valid && (secretChanged || hasStoredSecret);

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const input: Record<string, unknown> = {
        type: draft.type,
        clientId: draft.clientId.trim(),
      };
      // Typed secret wins; otherwise let the server reuse the stored one by id.
      if (secretChanged) input.clientSecret = draft.clientSecret;
      else if (isEditing && editing) input.id = editing.id;
      if (draft.type === "oidc") {
        input.issuer = draft.issuer.trim();
      } else {
        input.authorizationEndpoint = draft.authorizationEndpoint.trim();
        input.tokenEndpoint = draft.tokenEndpoint.trim();
        input.userinfoEndpoint = draft.userinfoEndpoint.trim();
      }
      const result = await rbacSsoAdminApi.testProvider(input);
      setTestResult(result);
      if (result.ok) toast.success("Provider test passed");
      else toast.error("Provider test failed", { description: result.err });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Test failed";
      log.error("SSO provider test failed", error);
      setTestResult({ ok: false, err: message });
      toast.error("Provider test failed", { description: message });
    } finally {
      setIsTesting(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      if (isEditing && editing) {
        await rbacSsoAdminApi.updateProvider(editing.id, payload);
      } else {
        await rbacSsoAdminApi.createProvider(payload);
      }
    },
    onSuccess: () => {
      toast.success(isEditing ? "Provider updated" : "Provider created");
      // Adding/editing a provider changes the merged SSO config, so the settings
      // panel's gating (hasProviders + source/read-only) must re-derive from the
      // server — invalidate both queries, not just the provider list.
      queryClient.invalidateQueries({ queryKey: ["sso-admin-providers"] });
      queryClient.invalidateQueries({ queryKey: ["sso-settings"] });
      onClose();
    },
    onError: (error: Error) => {
      log.error("Failed to save SSO provider", error);
      toast.error(`Failed to save provider: ${error.message}`);
    },
  });

  const testPassed = testResult?.ok === true;
  const canSave = (testPassed || saveAnyway) && !saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden rounded-xs border-ink-500 bg-ink-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-paper">
            <KeyRound className="h-4 w-4 text-paper-dim" />
            {isEditing ? `Edit provider — ${editing?.displayName}` : "Add SSO provider"}
          </DialogTitle>
          <DialogDescription className="text-paper-muted">
            {step === 1 && "Step 1 of 3 — type & identity."}
            {step === 2 && "Step 2 of 3 — endpoints & claim mapping."}
            {step === 3 && "Step 3 of 3 — test the configuration, then save."}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-2 px-1 pb-2">
          {STEP_LABELS.map((label, i) => {
            const n = i + 1;
            const last = STEP_LABELS.length;
            // Final step turns green once the test passes, red if it failed.
            const isComplete = step > n || (n === last && testPassed);
            const isFailed = n === last && step === last && testResult != null && !testResult.ok;
            return (
              <div key={label} className="flex items-center gap-2">
                <span
                  className={cn(
                    "grid h-5 w-5 place-items-center rounded-full font-mono text-[10px]",
                    isComplete
                      ? "bg-emerald-600 text-ink-50"
                      : isFailed
                        ? "bg-red-600 text-ink-50"
                        : step === n
                          ? "bg-brand text-ink-50"
                          : "bg-ink-300 text-paper-faint",
                  )}
                >
                  {isComplete ? <Check className="h-3 w-3" /> : isFailed ? <X className="h-3 w-3" /> : n}
                </span>
                <span
                  className={cn(
                    "font-mono text-[10px] uppercase tracking-[0.14em]",
                    step === n ? "text-paper" : "text-paper-faint",
                  )}
                >
                  {label}
                </span>
                {n < STEP_LABELS.length && <span className="mx-1 h-px w-4 bg-ink-500" />}
              </div>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-2">
          {/* STEP 1 — Identity */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className={LABEL_CLASS}>Type</Label>
                  <Select
                    value={draft.type}
                    onValueChange={(v) => update({ type: v as ProviderType })}
                  >
                    <SelectTrigger className={INPUT_CLASS}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="oidc">OIDC</SelectItem>
                      <SelectItem value="oauth2">OAuth2</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className={LABEL_CLASS}>Provider id (slug)</Label>
                  <Input
                    value={draft.id}
                    onChange={(e) =>
                      update({ id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })
                    }
                    placeholder="okta"
                    className={INPUT_CLASS}
                    disabled={isEditing}
                  />
                  {!isEditing && draft.id && !SLUG_RE.test(draft.id) && (
                    <p className="text-[11px] text-red-300">Use lowercase letters, digits, - or _.</p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className={LABEL_CLASS}>Display name</Label>
                <Input
                  value={draft.displayName}
                  onChange={(e) => update({ displayName: e.target.value })}
                  placeholder="Okta"
                  className={INPUT_CLASS}
                />
              </div>

              <div className="space-y-1.5">
                <Label className={LABEL_CLASS}>Client ID</Label>
                <Input
                  value={draft.clientId}
                  onChange={(e) => update({ clientId: e.target.value })}
                  placeholder="0oa1b2c3..."
                  className={INPUT_CLASS}
                />
              </div>

              <div className="space-y-1.5">
                <Label className={cn(LABEL_CLASS, "flex items-center gap-1.5")}>
                  Client secret
                  {isEditing && editing?.hasSecret && (
                    <span className="normal-case tracking-normal text-paper-faint">
                      (leave empty to keep)
                    </span>
                  )}
                </Label>
                <Input
                  type="password"
                  value={draft.clientSecret}
                  onChange={(e) => update({ clientSecret: e.target.value })}
                  placeholder={isEditing && editing?.hasSecret ? SECRET_PLACEHOLDER : "••••••••"}
                  className={INPUT_CLASS}
                />
              </div>

              {/* Enabled toggle */}
              <div className="flex items-center justify-between gap-3 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5">
                <div className="flex flex-col gap-0.5">
                  <Label className="text-[13px] font-medium text-paper">Enabled</Label>
                  <span className={HELP_CLASS}>Disabled providers are hidden from the login page.</span>
                </div>
                <Switch checked={draft.enabled} onCheckedChange={(v) => update({ enabled: v })} />
              </div>
            </div>
          )}

          {/* STEP 2 — Endpoints & mapping */}
          {step === 2 && (
            <div className="space-y-5">
              {/* --- Endpoints --- */}
              <section className="space-y-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                  {draft.type === "oidc" ? "Issuer" : "Endpoints"}
                </p>
                {draft.type === "oidc" ? (
                  <div className="space-y-1.5">
                    <Label className={LABEL_CLASS}>Issuer URL</Label>
                    <Input
                      value={draft.issuer}
                      onChange={(e) => update({ issuer: e.target.value })}
                      placeholder="https://example.okta.com"
                      className={cn(INPUT_CLASS, urlInvalid(draft.issuer) && "border-red-500/60")}
                    />
                    {urlInvalid(draft.issuer) ? (
                      <p className="text-[11px] text-red-300">Enter a valid URL (https://…).</p>
                    ) : (
                      <p className={HELP_CLASS}>The OIDC discovery document is fetched from this issuer.</p>
                    )}
                  </div>
                ) : (
                  <>
                    {(
                      [
                        ["Authorization endpoint", "authorizationEndpoint", "https://provider/oauth/authorize"],
                        ["Token endpoint", "tokenEndpoint", "https://provider/oauth/token"],
                        ["Userinfo endpoint", "userinfoEndpoint", "https://provider/oauth/userinfo"],
                      ] as const
                    ).map(([label, key, placeholder]) => (
                      <div key={key} className="space-y-1.5">
                        <Label className={LABEL_CLASS}>{label}</Label>
                        <Input
                          value={draft[key]}
                          onChange={(e) => update({ [key]: e.target.value })}
                          placeholder={placeholder}
                          className={cn(INPUT_CLASS, urlInvalid(draft[key]) && "border-red-500/60")}
                        />
                        {urlInvalid(draft[key]) && (
                          <p className="text-[11px] text-red-300">Enter a valid URL (https://…).</p>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </section>

              {/* --- Scopes & attribute mapping --- */}
              <section className="space-y-3 border-t border-ink-500 pt-4">
                <div className="space-y-1.5">
                  <Label className={LABEL_CLASS}>Scopes</Label>
                  <Input
                    value={draft.scopes}
                    onChange={(e) => update({ scopes: e.target.value })}
                    placeholder="openid profile email"
                    className={INPUT_CLASS}
                  />
                  <p className={HELP_CLASS}>Space-separated scopes requested from the provider.</p>
                </div>
                {draft.type === "oauth2" && (
                  <div className="space-y-1.5">
                    <Label className={LABEL_CLASS}>Attribute mapping (optional)</Label>
                    <Input
                      value={draft.claimMapping}
                      onChange={(e) => update({ claimMapping: e.target.value })}
                      placeholder="email=email,name=displayName"
                      className={INPUT_CLASS}
                    />
                    <p className={HELP_CLASS}>Map provider claims to user fields (key=value pairs).</p>
                  </div>
                )}
              </section>

              {/* --- Role mapping (optional, bounded block) --- */}
              <section className="space-y-3 rounded-xs border border-ink-500 bg-ink-200 p-3">
                <div className="flex flex-col gap-0.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                    Role mapping (optional)
                  </p>
                  <p className={HELP_CLASS}>
                    Assign local roles from a provider claim on every sign-in. Leave empty to use the default role.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className={LABEL_CLASS}>Claim to read</Label>
                  <Input
                    value={draft.roleMappingClaim}
                    onChange={(e) => update({ roleMappingClaim: e.target.value })}
                    placeholder="groups"
                    className={cn(INPUT_CLASS, "max-w-xs")}
                  />
                </div>
                <RoleMappingEditor
                  rows={draft.roleMappingRows}
                  roles={roles ?? []}
                  onChange={(rows) => update({ roleMappingRows: rows })}
                />
              </section>
            </div>
          )}

          {/* STEP 3 — Test & save */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-xs border border-ink-500 bg-ink-200 p-3">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Review</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                  <dt className="text-paper-faint">id</dt>
                  <dd className="font-mono text-paper">{draft.id || editing?.id}</dd>
                  <dt className="text-paper-faint">type</dt>
                  <dd className="font-mono text-paper">{draft.type}</dd>
                  <dt className="text-paper-faint">name</dt>
                  <dd className="text-paper">{draft.displayName}</dd>
                  {draft.type === "oidc" ? (
                    <>
                      <dt className="text-paper-faint">issuer</dt>
                      <dd className="break-all font-mono text-paper-muted">{draft.issuer}</dd>
                    </>
                  ) : (
                    <>
                      <dt className="text-paper-faint">token</dt>
                      <dd className="break-all font-mono text-paper-muted">{draft.tokenEndpoint}</dd>
                    </>
                  )}
                </dl>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={handleTest}
                disabled={!canTest || isTesting}
                className="h-9 w-full gap-2 rounded-xs border-ink-500 bg-ink-200 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-300 disabled:opacity-50"
              >
                {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Test configuration
              </Button>

              {!canTest && (
                <p className="flex items-center gap-1.5 text-[11px] text-paper-faint">
                  <AlertCircle className="h-3 w-3" />
                  {!step2Valid
                    ? "Complete the endpoint fields to run a test."
                    : "Enter the client secret to run a live test."}
                </p>
              )}

              {testResult && (
                <div
                  className={cn(
                    "flex flex-col gap-1.5 rounded-xs border px-3 py-2.5",
                    testResult.ok
                      ? "border-emerald-500/40 bg-emerald-950/30"
                      : "border-red-500/40 bg-red-950/30",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {testResult.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-red-300" />
                    )}
                    <span
                      className={cn(
                        "text-[13px] font-medium",
                        testResult.ok ? "text-emerald-200" : "text-red-200",
                      )}
                    >
                      {testResult.ok ? "Configuration looks valid" : "Test failed"}
                    </span>
                  </div>
                  {!testResult.ok && (
                    <div className="space-y-0.5 pl-6 font-mono text-[11px] leading-[1.5] text-red-300">
                      {testResult.err && <p>{testResult.err}</p>}
                      {testResult.oauthError && (
                        <p>
                          {testResult.oauthError}
                          {testResult.oauthErrorDescription ? `: ${testResult.oauthErrorDescription}` : ""}
                        </p>
                      )}
                      {testResult.code && <p>code: {testResult.code}</p>}
                      {testResult.cause && <p>cause: {testResult.cause}</p>}
                    </div>
                  )}
                </div>
              )}

              {!testPassed && (
                <label className="flex cursor-pointer items-center gap-2 rounded-xs border border-amber-900/60 bg-amber-950/40 px-3 py-2">
                  <Switch checked={saveAnyway} onCheckedChange={setSaveAnyway} />
                  <span className="text-[12px] text-amber-200">
                    Save without a passing test (use if the test is unavailable or a transient outage).
                  </span>
                </label>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 border-t border-ink-500 pt-3">
          <Button
            variant="ghost"
            onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
            className="h-9 gap-1 rounded-xs font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper"
          >
            {step === 1 ? "Cancel" : (
              <>
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </>
            )}
          </Button>
          {step < 3 ? (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={step === 1 ? !step1Valid : !step2Valid}
              className="h-9 gap-1 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50"
            >
              Next <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!canSave}
              className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {isEditing ? "Save provider" : "Create provider"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// Providers list
// ============================================

function ProvidersPanel({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { data: providers, isLoading } = useQuery({
    queryKey: ["sso-admin-providers"],
    queryFn: () => rbacSsoAdminApi.getProviders(),
  });

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<SsoAdminProvider | null>(null);
  const [toDelete, setToDelete] = useState<SsoAdminProvider | null>(null);
  const [toDisable, setToDisable] = useState<SsoAdminProvider | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rbacSsoAdminApi.deleteProvider(id),
    onSuccess: (result) => {
      toast.success(`Provider deleted — unlinked ${result.unlinkedUserCount} user(s)`);
      queryClient.invalidateQueries({ queryKey: ["sso-admin-providers"] });
      queryClient.invalidateQueries({ queryKey: ["sso-settings"] });
      setToDelete(null);
    },
    onError: (error: Error) => {
      log.error("Failed to delete SSO provider", error);
      toast.error(`Failed to delete provider: ${error.message}`);
    },
  });

  // Quick enable/disable straight from the row, no wizard needed.
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      rbacSsoAdminApi.updateProvider(id, { enabled }),
    onSuccess: (_data, { enabled }) => {
      toast.success(enabled ? "Provider enabled" : "Provider disabled");
      queryClient.invalidateQueries({ queryKey: ["sso-admin-providers"] });
      queryClient.invalidateQueries({ queryKey: ["sso-settings"] });
      setToDisable(null);
    },
    onError: (error: Error) => {
      log.error("Failed to toggle SSO provider", error);
      toast.error(`Failed to update provider: ${error.message}`);
    },
  });

  const openCreate = () => {
    setEditing(null);
    setWizardOpen(true);
  };
  const openEdit = (provider: SsoAdminProvider) => {
    setEditing(provider);
    setWizardOpen(true);
  };

  return (
    <div className="rounded-xs border border-ink-500 bg-ink-100">
      <div className="flex items-center gap-2 border-b border-ink-500 px-4 py-3">
        <KeyRound className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
        <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper">Providers</h3>
        {canManage && (
          <Button
            size="sm"
            onClick={openCreate}
            className="ml-auto h-8 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
          >
            <Plus className="h-3.5 w-3.5" />
            Add provider
          </Button>
        )}
      </div>

      <div className="p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-paper-dim" />
          </div>
        ) : !providers || providers.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <KeyRound className="mx-auto mb-3 h-7 w-7 text-paper-faint" aria-hidden />
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">No SSO providers</p>
            <p className="mt-2 text-[12px] text-paper-muted">
              Add an OIDC or OAuth2 provider, or configure one via environment variables.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {providers.map((provider) => {
              const isConfig = provider.source === "config";
              return (
                <div
                  key={provider.id}
                  className="flex items-center justify-between gap-3 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
                      <KeyRound className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-paper">{provider.displayName}</span>
                        <span className="inline-flex items-center rounded-xs border border-ink-500 bg-ink-100 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-muted">
                          {provider.type}
                        </span>
                        {isConfig && (
                          <span className="inline-flex items-center gap-1 rounded-xs border border-amber-900/60 bg-amber-950/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-amber-200">
                            <Lock className="h-2.5 w-2.5" />
                            from config · read-only
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-paper-faint">
                        {provider.id}
                        {typeof provider.linkedUserCount === "number" && (
                          <span> · {provider.linkedUserCount} linked user(s)</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    {/* Status dot — green when enabled, grey when disabled (all providers). */}
                    <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em]">
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full",
                          provider.enabled ? "bg-emerald-400" : "bg-paper-faint",
                        )}
                        aria-hidden
                      />
                      <span className={provider.enabled ? "text-emerald-300" : "text-paper-faint"}>
                        {provider.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </span>

                    {canManage && !isConfig && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 rounded-xs text-paper-dim hover:bg-ink-300 hover:text-paper"
                            aria-label="Provider actions"
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                          {provider.enabled ? (
                            <DropdownMenuItem
                              onClick={() => setToDisable(provider)}
                              className="cursor-pointer text-amber-300 focus:bg-amber-950/40 focus:text-amber-200"
                            >
                              <PowerOff className="mr-2 h-3.5 w-3.5" />
                              Disable
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => toggleMutation.mutate({ id: provider.id, enabled: true })}
                              disabled={toggleMutation.isPending}
                              className="cursor-pointer text-emerald-300 focus:bg-emerald-950/40 focus:text-emerald-200"
                            >
                              <Power className="mr-2 h-3.5 w-3.5" />
                              Enable
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator className="bg-ink-500" />
                          <DropdownMenuItem
                            onClick={() => openEdit(provider)}
                            className="cursor-pointer focus:bg-ink-200"
                          >
                            <Pencil className="mr-2 h-3.5 w-3.5" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-ink-500" />
                          <DropdownMenuItem
                            onClick={() => setToDelete(provider)}
                            className="cursor-pointer text-red-400 hover:bg-red-950/40 focus:bg-red-950/40 focus:text-red-300"
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ProviderWizard open={wizardOpen} onClose={() => setWizardOpen(false)} editing={editing} />

      {/* Delete confirmation — DataAccessPolicies / EditUser AlertDialog style */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent className="rounded-xs border-ink-500 bg-ink-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-paper">
              <AlertTriangle className="h-4 w-4 text-red-300" />
              Delete SSO provider
            </AlertDialogTitle>
            <AlertDialogDescription className="text-paper-muted">
              Delete <strong className="text-paper">{toDelete?.displayName}</strong>? This will force-unlink{" "}
              <strong className="text-paper">{toDelete?.linkedUserCount ?? 0}</strong> linked user(s). SSO-only users
              will be locked out until an administrator resets their password. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleteMutation.isPending}
              className="h-9 rounded-xs border-ink-500 bg-ink-200 text-paper hover:border-ink-700 hover:bg-ink-300"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (toDelete) deleteMutation.mutate(toDelete.id);
              }}
              disabled={deleteMutation.isPending}
              className="h-9 gap-2 rounded-xs border border-red-900/60 bg-red-950/40 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-red-200 hover:bg-red-950/60"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete & unlink
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Disable confirmation — warns about impact on linked users (links preserved). */}
      <AlertDialog open={!!toDisable} onOpenChange={(o) => !o && setToDisable(null)}>
        <AlertDialogContent className="rounded-xs border-ink-500 bg-ink-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-paper">
              <AlertTriangle className="h-4 w-4 text-amber-300" />
              Disable SSO provider
            </AlertDialogTitle>
            <AlertDialogDescription className="text-paper-muted">
              Disable <strong className="text-paper">{toDisable?.displayName}</strong>? It will be hidden from the
              login page, and <strong className="text-paper">{toDisable?.linkedUserCount ?? 0}</strong> linked user(s)
              won't be able to sign in via SSO until you re-enable it. Their identity links are preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={toggleMutation.isPending}
              className="h-9 rounded-xs border-ink-500 bg-ink-200 text-paper hover:border-ink-700 hover:bg-ink-300"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (toDisable) toggleMutation.mutate({ id: toDisable.id, enabled: false });
              }}
              disabled={toggleMutation.isPending}
              className="h-9 gap-2 rounded-xs border border-amber-900/60 bg-amber-950/40 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200 hover:bg-amber-950/60"
            >
              {toggleMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Disabling…
                </>
              ) : (
                <>
                  <PowerOff className="h-3.5 w-3.5" />
                  Disable
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================
// Root
// ============================================

const SsoSettings: React.FC = () => {
  const { hasPermission } = useRbacStore();
  const canManage = hasPermission(RBAC_PERMISSIONS.SSO_MANAGE);

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
          <span className="h-px w-6 bg-ink-700" />
          <span>Single sign-on</span>
        </span>
        <p className="text-[12px] text-paper-muted">
          Global SSO settings and OIDC / OAuth2 providers. Providers from environment config are read-only.
        </p>
      </div>

      <SettingsPanel canManage={canManage} />
      <ProvidersPanel canManage={canManage} />
    </div>
  );
};

export default SsoSettings;
