/**
 * Login Page
 *
 * RBAC-based authentication for CHouse UI.
 * Users authenticate against the RBAC system, not directly to ClickHouse.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ArrowUpRight, ChevronDown, Eye, EyeOff, Loader2, Lock, ShieldCheck, User } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useRbacStore } from "@/stores";
import { ssoApi, authConfigApi } from "@/api/rbac";
import { SsoProviderIcon } from "@/features/auth/SsoProviderIcon";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { withBasePath } from "@/lib/basePath";
import { cn } from "@/lib/utils";
import { log } from "@/lib/log";

const loginSchema = z.object({
  identifier: z.string().min(1, "Email or username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

const Logo = withBasePath("logo.svg");

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";
  const ssoError = searchParams.get("ssoError");

  const { login, isLoading, error, isAuthenticated, clearError } = useRbacStore();
  const [showPassword, setShowPassword] = useState(false);
  const [ssoExpanded, setSsoExpanded] = useState(false);

  // Show a few providers up front; collapse the rest behind a toggle so a long
  // provider list doesn't push the password form off the card.
  const SSO_COLLAPSED_COUNT = 3;

  const { data: ssoProviders = [], isLoading: ssoProvidersLoading } = useQuery({
    queryKey: ["sso-providers"],
    queryFn: ssoApi.getProviders,
    // Keep the login buttons in sync with the live provider list — admins can
    // enable/disable SSO at any time, so don't show a long-stale button.
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const ssoHasMore = ssoProviders.length > SSO_COLLAPSED_COUNT;
  const visibleSsoProviders =
    ssoExpanded || !ssoHasMore ? ssoProviders : ssoProviders.slice(0, SSO_COLLAPSED_COUNT);

  // Whether to render the password form. The server is the source of truth, so
  // we wait for the config to resolve before deciding (see `authConfigLoading`
  // below) — otherwise an optimistic default would flash the password form on
  // load and then yank it away when "password login disabled" arrives. Once
  // resolved, a *failed* fetch falls back to `true` so a config error can never
  // hide the only way in.
  const { data: authConfig, isLoading: authConfigLoading } = useQuery({
    queryKey: ["auth-config"],
    queryFn: authConfigApi.get,
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const passwordLoginEnabled = authConfig?.passwordLoginEnabled ?? true;

  // Render the available sign-in methods only once both the SSO provider list and
  // the auth config are known, so the whole region resolves in one paint instead
  // of flashing the password form (or "SSO only" message) before its companion.
  const authMethodsLoading = authConfigLoading || ssoProvidersLoading;

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      identifier: "",
      password: "",
    },
  });

  const onSubmit = async (values: LoginFormData) => {
    clearError();
    try {
      await login(values.identifier, values.password);
    } catch (err) {
      log.error("Login failed:", err);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      navigate(redirectTo);
    }
  }, [isAuthenticated, navigate, redirectTo]);

  return (
    <div className="dark min-h-screen w-full bg-ink-50 text-paper">
      {/* Static dot grid — replaces blur orbs */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-50"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255, 255, 255, 0.06) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage:
            "radial-gradient(ellipse 60% 50% at 50% 40%, black, transparent)",
          WebkitMaskImage:
            "radial-gradient(ellipse 60% 50% at 50% 40%, black, transparent)",
        }}
      />

      <div className="relative grid min-h-screen place-items-center px-6 py-12">
        <div className="w-full max-w-[420px]">
          {/* Wordmark */}
          <div className="mb-10 flex items-center justify-center gap-2.5">
            <img src={Logo} alt="" aria-hidden className="h-7 w-7" />
            <span className="text-[16px] font-semibold tracking-tight text-paper">
              chouse<span className="text-paper-dim">-fleet</span>
            </span>
          </div>

          {/* Card */}
          <div className="rounded-md border border-ink-500 bg-ink-100">
            {/* Header */}
            <div className="flex flex-col gap-3 border-b border-ink-500 px-7 py-6">
              <span className="inline-flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">
                <span className="text-paper-faint">01</span>
                <span className="h-px w-6 bg-ink-700" aria-hidden />
                Sign in
              </span>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-paper">
                  Welcome back.
                </h1>
                <p className="mt-1 text-sm text-paper-muted">
                  Sign in to see every ClickHouse cluster you can reach.
                </p>
              </div>
            </div>

            {/* Form */}
            <div className="px-7 py-7">
              {!authMethodsLoading && ssoProviders.length > 0 && (
                <div className="mb-5 flex flex-col gap-2">
                  <div className="flex flex-col gap-2">
                    {visibleSsoProviders.map((provider) => (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => {
                          window.location.href = ssoApi.startUrl(provider.id, redirectTo);
                        }}
                        aria-label={`Continue with ${provider.displayName}`}
                        className="group relative flex h-10 w-full items-center rounded-xs border border-ink-500 bg-ink-200 px-3 text-[13px] font-medium tracking-tight text-paper-muted transition-colors hover:border-ink-700 hover:bg-ink-300 hover:text-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink-100"
                      >
                        <SsoProviderIcon provider={provider} className="absolute left-3 h-[18px] w-[18px]" />
                        <span className="w-full text-center">Continue with {provider.displayName}</span>
                      </button>
                    ))}
                  </div>

                  {ssoHasMore && (
                    <button
                      type="button"
                      onClick={() => setSsoExpanded((v) => !v)}
                      aria-expanded={ssoExpanded}
                      className="flex items-center justify-center gap-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint transition-colors hover:text-paper-muted focus:outline-none focus-visible:text-paper"
                    >
                      {ssoExpanded
                        ? "Show fewer options"
                        : `Show ${ssoProviders.length - SSO_COLLAPSED_COUNT} more`}
                      <ChevronDown
                        className={cn("h-3 w-3 transition-transform", ssoExpanded && "rotate-180")}
                        aria-hidden
                      />
                    </button>
                  )}

                  {passwordLoginEnabled && (
                    <div className="my-1 flex items-center gap-3" aria-hidden>
                      <span className="h-px flex-1 bg-ink-500" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                        or sign in with password
                      </span>
                      <span className="h-px flex-1 bg-ink-500" />
                    </div>
                  )}
                </div>
              )}

              {/* Auth error — shown whether or not the password form is rendered
                  (e.g. an ssoError from a failed IdP redirect). */}
              {(error || ssoError) && (
                <div
                  role="alert"
                  className="mb-5 flex items-start gap-2 rounded-xs border border-red-900/60 bg-red-950/40 px-3 py-2.5 text-[13px] text-red-200"
                >
                  <span aria-hidden className="font-mono text-red-300">!</span>
                  <span>{error || ssoError}</span>
                </div>
              )}

              {/* Defer the whole sign-in-method area until both the SSO list and
                  the auth config resolve, so nothing flashes in and out. */}
              {authMethodsLoading && (
                <div className="flex justify-center py-6" aria-hidden>
                  <Loader2 className="h-5 w-5 motion-safe:animate-spin text-paper-dim" />
                </div>
              )}

              {/* Password sign-in disabled — the server only reports this when at
                  least one usable SSO provider exists (it force-enables password
                  login otherwise, to prevent lockout), so SSO buttons are always
                  rendered above this message. */}
              {!authMethodsLoading && !passwordLoginEnabled && (
                <p className="text-center text-[13px] text-paper-muted">
                  Password sign-in is disabled. Continue with single sign-on above.
                </p>
              )}

              {!authMethodsLoading && passwordLoginEnabled && (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
                  <FormField
                    control={form.control}
                    name="identifier"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper-muted">
                          Email or username
                        </FormLabel>
                        <FormControl>
                          <div className="relative">
                            <User
                              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-paper-dim"
                              aria-hidden
                            />
                            <Input
                              placeholder="admin@localhost"
                              autoComplete="username"
                              {...field}
                              className="h-11 rounded-xs border-ink-500 bg-ink-200 pl-9 font-mono text-[13px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
                            />
                          </div>
                        </FormControl>
                        <FormMessage className="font-mono text-[11px] uppercase tracking-[0.14em]" />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper-muted">
                          Password
                        </FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Lock
                              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-paper-dim"
                              aria-hidden
                            />
                            <Input
                              type={showPassword ? "text" : "password"}
                              placeholder="••••••••"
                              autoComplete="current-password"
                              {...field}
                              className="h-11 rounded-xs border-ink-500 bg-ink-200 pl-9 pr-10 font-mono text-[13px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword((v) => !v)}
                              className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-xs text-paper-dim transition-colors hover:bg-ink-300 hover:text-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
                              aria-label={showPassword ? "Hide password" : "Show password"}
                              aria-pressed={showPassword}
                            >
                              {showPassword ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage className="font-mono text-[11px] uppercase tracking-[0.14em]" />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    disabled={isLoading}
                    aria-busy={isLoading}
                    className="group h-11 w-full rounded-xs bg-brand text-ink-50 hover:bg-brand-soft motion-safe:hover:-translate-y-px font-semibold tracking-tight transition-[transform,background-color] duration-200 disabled:opacity-60 disabled:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink-100"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" />
                        Signing in…
                      </>
                    ) : (
                      <>
                        Sign in
                        <ArrowUpRight className="ml-2 h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5" />
                      </>
                    )}
                  </Button>
                </form>
              </Form>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-ink-500 px-7 py-4">
              <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                <ShieldCheck className="h-3 w-3" aria-hidden />
                RBAC enforced
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                v{__CH_UI_VERSION__}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
