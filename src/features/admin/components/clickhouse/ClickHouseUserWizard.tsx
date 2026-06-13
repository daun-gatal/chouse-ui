/**
 * ClickHouseUserWizard
 *
 * Multi-step dialog to create or edit a native ClickHouse user:
 *   Identity → Roles → Review
 *
 * Access is granted exclusively through native roles — there is no per-user
 * direct-grant editing here (legacy direct grants are left untouched and can be
 * turned into a role via "Extract to role"). Mirrors the RBAC role wizard chrome.
 */

import { useEffect, useMemo, useState } from "react";
import {
  UserCog,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  Eye,
  EyeOff,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { log } from "@/lib/log";
import { cn } from "@/lib/utils";
import {
  rbacClickHouseUsersApi,
  type ClickHouseRole,
  type DefaultRoles,
  type CreateClickHouseUserInput,
  type UpdateClickHouseUserInput,
} from "@/api/rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClusterSelect } from "./ClusterSelect";

const AUTH_TYPES = [
  { value: "sha256_password", label: "SHA-256 password" },
  { value: "double_sha1_password", label: "Double SHA-1 password" },
  { value: "plaintext_password", label: "Plaintext password" },
  { value: "bcrypt_password", label: "bcrypt password" },
  { value: "no_password", label: "No password" },
];

const labelCls = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim";
const inputCls =
  "rounded-xs border-ink-500 bg-ink-200 text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0";
const sectionLabelCls =
  "inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim";

const STEPS = ["Identity", "Roles", "Review"];
type Step = 1 | 2 | 3;

interface ClickHouseUserWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  availableRoles: ClickHouseRole[];
  /** Username when editing; null/undefined when creating. */
  editingUser?: string | null;
}

interface FormState {
  username: string;
  authType: string;
  password: string;
  hostIp: string;
  hostNames: string;
  cluster: string;
  roles: string[];
  defaultAll: boolean;
  defaultRoles: string[];
}

function emptyForm(): FormState {
  return {
    username: "",
    authType: "sha256_password",
    password: "",
    hostIp: "",
    hostNames: "",
    cluster: "",
    roles: [],
    defaultAll: true,
    defaultRoles: [],
  };
}

function passwordChecks(password: string) {
  return {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
  };
}

const RequirementItem = ({ ok, label }: { ok: boolean; label: string }) => (
  <div className={cn("flex items-center gap-2 text-[11px] transition-colors", ok ? "text-emerald-300" : "text-paper-faint")}>
    <span className={cn("grid h-3 w-3 place-items-center rounded-full border", ok ? "border-emerald-700 bg-emerald-950/40" : "border-ink-500 bg-ink-200")}>
      {ok ? <Check className="h-2 w-2" /> : <span className="h-1 w-1 rounded-full bg-paper-faint" />}
    </span>
    <span>{label}</span>
  </div>
);

function generatePassword(): string {
  const pools = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%^&*"];
  const all = pools.join("");
  let pwd = pools.map((p) => p[Math.floor(Math.random() * p.length)]).join("");
  for (let i = 0; i < 12; i++) pwd += all[Math.floor(Math.random() * all.length)];
  return pwd.split("").sort(() => Math.random() - 0.5).join("");
}

export function ClickHouseUserWizard({ isOpen, onClose, onSaved, availableRoles, editingUser }: ClickHouseUserWizardProps) {
  const isEditing = !!editingUser;

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setShowPassword(false);
    setForm({ ...emptyForm(), username: editingUser ?? "" });
    if (editingUser) {
      setLoading(true);
      rbacClickHouseUsersApi
        .get(editingUser)
        .then((detail) => {
          const defaultAll = detail.defaultRoles === "ALL";
          setForm({
            username: editingUser,
            authType: detail.auth_type || "sha256_password",
            password: "",
            hostIp: detail.host_ip ?? "",
            hostNames: detail.host_names ?? "",
            cluster: "",
            roles: detail.roles,
            defaultAll,
            defaultRoles: defaultAll ? [] : (detail.defaultRoles as string[]),
          });
        })
        .catch((error) => {
          log.error("Failed to load user", error);
          toast.error(error instanceof Error ? error.message : "Failed to load user");
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen, editingUser]);

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const toggleRole = (role: string, checked: boolean) => {
    update({
      roles: checked ? [...form.roles, role] : form.roles.filter((r) => r !== role),
      defaultRoles: checked ? form.defaultRoles : form.defaultRoles.filter((r) => r !== role),
    });
  };

  const defaultRolesValue = (): DefaultRoles => (form.defaultAll ? "ALL" : form.defaultRoles);

  const checks = useMemo(() => passwordChecks(form.password), [form.password]);
  const allChecksPass = Object.values(checks).every(Boolean);
  const passwordRequired = !isEditing && form.authType !== "no_password";
  const passwordTouched = form.password.length > 0;
  const passwordValid = form.authType === "no_password" || (passwordRequired ? allChecksPass : !passwordTouched || allChecksPass);
  const usernameValid = isEditing || /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(form.username.trim());
  const step1Valid = usernameValid && passwordValid;
  // A role is mandatory when creating a user (access comes only from roles).
  const step2Valid = isEditing || form.roles.length > 0;

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const cluster = form.cluster.trim() || undefined;
      if (isEditing && editingUser) {
        const input: UpdateClickHouseUserInput = {
          hostIp: form.hostIp,
          hostNames: form.hostNames,
          cluster,
          roles: form.roles,
          defaultRoles: defaultRolesValue(),
        };
        if (form.password) input.password = form.password;
        await rbacClickHouseUsersApi.update(editingUser, input);
        toast.success(`User "${editingUser}" updated`);
      } else {
        const input: CreateClickHouseUserInput = {
          username: form.username.trim(),
          authType: form.authType,
          hostIp: form.hostIp || undefined,
          hostNames: form.hostNames || undefined,
          cluster,
          roles: form.roles,
          defaultRoles: defaultRolesValue(),
        };
        if (form.authType !== "no_password") input.password = form.password;
        await rbacClickHouseUsersApi.create(input);
        toast.success(`User "${form.username.trim()}" created`);
      }
      onSaved();
      onClose();
    } catch (error) {
      log.error("Failed to save ClickHouse user", error);
      toast.error(error instanceof Error ? error.message : "Failed to save ClickHouse user");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden rounded-xs border-ink-500 bg-ink-100 p-0">
        <DialogHeader className="flex-shrink-0 border-b border-ink-500 px-6 pb-4 pt-6">
          <DialogTitle asChild>
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                <UserCog className="h-4 w-4" aria-hidden />
              </span>
              <div className="flex flex-1 flex-col gap-0.5 text-left">
                <h2 className="text-[16px] font-semibold tracking-tight text-paper">
                  {isEditing ? `Edit user: ${editingUser}` : "Create ClickHouse user"}
                </h2>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  Native ClickHouse database account
                </p>
              </div>
            </div>
          </DialogTitle>
          <DialogDescription className="mt-1 text-[12px] text-paper-muted">
            {step === 1 && "Step 1 of 3 — identity, authentication and host."}
            {step === 2 && "Step 2 of 3 — assign native roles and defaults."}
            {step === 3 && "Step 3 of 3 — review and apply."}
          </DialogDescription>

          {/* Stepper */}
          <div className="mt-3 flex items-center gap-2 px-1">
            {STEPS.map((label, i) => {
              const n = (i + 1) as Step;
              return (
                <div key={label} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "grid h-5 w-5 place-items-center rounded-full font-mono text-[10px]",
                      step === n ? "bg-brand text-ink-50" : step > n ? "bg-emerald-600 text-ink-50" : "bg-ink-300 text-paper-faint",
                    )}
                  >
                    {step > n ? <Check className="h-3 w-3" /> : n}
                  </span>
                  <span className={cn("font-mono text-[10px] uppercase tracking-[0.14em]", step === n ? "text-paper" : "text-paper-faint")}>
                    {label}
                  </span>
                  {n < STEPS.length && <span className="mx-1 h-px w-4 bg-ink-500" />}
                </div>
              );
            })}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-paper-dim" />
            </div>
          ) : (
            <>
              {/* Step 1 — Identity */}
              {step === 1 && (
                <div className="space-y-4">
                  {!isEditing && (
                    <div className="space-y-2">
                      <Label className={labelCls}>
                        Username <span className="text-red-400">*</span>
                      </Label>
                      <Input value={form.username} onChange={(e) => update({ username: e.target.value })} placeholder="e.g., alice" className={inputCls} />
                      <p className="text-[11px] text-paper-faint">Must start with a letter or underscore; letters, numbers and underscores only.</p>
                    </div>
                  )}

                  {!isEditing && (
                    <div className="space-y-2">
                      <Label className={labelCls}>Authentication</Label>
                      <Select value={form.authType} onValueChange={(v) => update({ authType: v })}>
                        <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {AUTH_TYPES.map((a) => (
                            <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {form.authType !== "no_password" && (
                    <div className="space-y-2">
                      <Label className={labelCls}>
                        {isEditing ? "New password (optional)" : "Password"}
                        {!isEditing && <span className="text-red-400"> *</span>}
                      </Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            type={showPassword ? "text" : "password"}
                            value={form.password}
                            onChange={(e) => update({ password: e.target.value })}
                            placeholder="••••••••"
                            className={`pr-10 ${inputCls}`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((s) => !s)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-paper-dim hover:text-paper"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => { update({ password: generatePassword() }); setShowPassword(true); }}
                          className="h-9 shrink-0 gap-1.5 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
                        >
                          <Sparkles className="h-3.5 w-3.5" /> Generate
                        </Button>
                      </div>

                      {(passwordRequired || passwordTouched) && (
                        <div className="rounded-xs border border-ink-500 bg-ink-200 p-3">
                          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Password requirements</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            <RequirementItem ok={checks.length} label="At least 8 characters" />
                            <RequirementItem ok={checks.upper} label="Uppercase letter" />
                            <RequirementItem ok={checks.lower} label="Lowercase letter" />
                            <RequirementItem ok={checks.number} label="Number" />
                            <RequirementItem ok={checks.special} label="Special character" />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className={labelCls}>Cluster</Label>
                      <ClusterSelect value={form.cluster} onChange={(v) => update({ cluster: v })} className={inputCls} />
                    </div>
                    <div className="space-y-2">
                      <Label className={labelCls}>Host IP (optional)</Label>
                      <Input value={form.hostIp} onChange={(e) => update({ hostIp: e.target.value })} placeholder="10.0.0.0/8" className={inputCls} />
                    </div>
                    <div className="space-y-2">
                      <Label className={labelCls}>Host name (optional)</Label>
                      <Input value={form.hostNames} onChange={(e) => update({ hostNames: e.target.value })} placeholder="host.example.com" className={inputCls} />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2 — Roles */}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <span className={sectionLabelCls}>
                      <span className="h-px w-6 bg-ink-700" aria-hidden />
                      <span>Assign roles</span>
                      <span className="text-red-400">*</span>
                      {form.roles.length > 0 && (
                        <span className="rounded-xs border border-brand/40 px-1.5 py-0.5 text-brand">{form.roles.length} selected</span>
                      )}
                    </span>
                    {availableRoles.length === 0 ? (
                      <div className="rounded-xs border border-dashed border-ink-500 bg-ink-100 px-3 py-4 text-[12px] text-paper-faint">
                        No ClickHouse roles available. Create roles first to assign them.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 rounded-xs border border-ink-500 bg-ink-200 p-3 sm:grid-cols-2">
                        {availableRoles.map((role) => (
                          <label key={role.name} className="flex cursor-pointer items-center gap-2 text-[12px] text-paper-muted">
                            <Checkbox
                              checked={form.roles.includes(role.name)}
                              onCheckedChange={(c) => toggleRole(role.name, c === true)}
                              className="border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50"
                            />
                            <span className="font-mono">{role.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    {!step2Valid && availableRoles.length > 0 && (
                      <p className="flex items-center gap-1.5 text-[11px] text-amber-300">
                        At least one role is required to create a user.
                      </p>
                    )}
                  </div>

                  {form.roles.length > 0 && (
                    <div className="space-y-2">
                      <span className={sectionLabelCls}>
                        <span className="h-px w-6 bg-ink-700" aria-hidden />
                        <span>Default roles</span>
                      </span>
                      <div className="flex items-center gap-3 rounded-xs border border-ink-500 bg-ink-200 p-3">
                        <Switch checked={form.defaultAll} onCheckedChange={(c) => update({ defaultAll: c })} />
                        <span className="text-[12px] text-paper">All assigned roles active by default</span>
                      </div>
                      {!form.defaultAll && (
                        <div className="grid grid-cols-1 gap-2 rounded-xs border border-ink-500 bg-ink-200 p-3 sm:grid-cols-2">
                          {form.roles.map((role) => (
                            <label key={role} className="flex cursor-pointer items-center gap-2 text-[12px] text-paper-muted">
                              <Checkbox
                                checked={form.defaultRoles.includes(role)}
                                onCheckedChange={(c) =>
                                  update({
                                    defaultRoles: c === true ? [...form.defaultRoles, role] : form.defaultRoles.filter((r) => r !== role),
                                  })
                                }
                                className="border-ink-500 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-ink-50"
                              />
                              <span className="font-mono">{role}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Step 3 — Review */}
              {step === 3 && (
                <div className="space-y-2">
                  <span className={sectionLabelCls}>
                    <span className="h-px w-6 bg-ink-700" aria-hidden />
                    <span>Summary</span>
                  </span>
                  <div className="space-y-2 rounded-xs border border-ink-500 bg-ink-200 p-3 text-[12px]">
                    <div className="flex justify-between">
                      <span className={labelCls}>Username</span>
                      <span className="font-mono text-paper">{form.username || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={labelCls}>Authentication</span>
                      <span className="font-mono text-paper">{form.authType}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className={labelCls}>Roles</span>
                      <div className="flex flex-wrap justify-end gap-1">
                        {form.roles.length === 0 ? (
                          <span className="text-paper">—</span>
                        ) : (
                          form.roles.map((r) => (
                            <span key={r} className="rounded-xs border border-ink-500 bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted">{r}</span>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span className={labelCls}>Default roles</span>
                      <span className="font-mono text-paper">{form.defaultAll ? "ALL" : form.defaultRoles.join(", ") || "NONE"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={labelCls}>Cluster</span>
                      <span className="font-mono text-paper">{form.cluster.trim() || "—"}</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-ink-500 px-6 py-4">
          <Button
            variant="ghost"
            onClick={() => (step === 1 ? onClose() : setStep((step - 1) as Step))}
            disabled={saving}
            className="h-9 gap-1 rounded-xs font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper"
          >
            {step === 1 ? "Cancel" : <><ArrowLeft className="h-3.5 w-3.5" /> Back</>}
          </Button>

          {step < 3 ? (
            <Button
              onClick={() => setStep((step + 1) as Step)}
              disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
              className="h-9 gap-1 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={saving}
              className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {isEditing ? "Updating" : "Creating"}</>
              ) : (
                <><CheckCircle2 className="h-3.5 w-3.5" /> {isEditing ? "Update user" : "Create user"}</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ClickHouseUserWizard;
