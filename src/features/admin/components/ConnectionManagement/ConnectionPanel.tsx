/**
 * One panel for creating and editing a connection, with the tabs General,
 * ClickHouse login and Who can query. Each tab saves on its own; leaving a
 * tab (or closing) with unsaved changes asks first: Stay, Discard, or Save
 * and go. While creating, General and ClickHouse login share one form that
 * Create sends; after it the panel edits the new connection on Who can query.
 */

import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { getConnectionIdentity, IDENTITY_MODE_SHARED, identityKind, identityKindLabel } from "@/api/connectionIdentity";
import type { ClickHouseConnection } from "@/api/rbac";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRbacStore } from "@/stores";
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "./formStyles";
import { GeneralTab } from "./GeneralTab";
import {
  generalDraftFrom,
  isGeneralDirty,
  isLoginDirty,
  loginDraftFrom,
  PANEL_TAB_LABELS,
  storedLoginOf,
  whoCount,
  type GeneralDraft,
  type LoginDraft,
  type PanelTab,
} from "./loginForm";
import { LoginTab } from "./LoginTab";
import { WhoCanQueryTab } from "./WhoCanQueryTab";

/** Every person's own identity on each connection (the selector) is stale after a change here. */
const OWN_IDENTITIES_KEY = ["my-connection-identities"];

/** A super admin's read of a connection's login; stale after a save on the login or the role map. */
export function connectionIdentityKey(connectionId: string): readonly [string, string] {
  return ["connection-identity", connectionId];
}

export interface ConnectionPanelProps {
  /** The connection to edit; null creates one. */
  connection: ClickHouseConnection | null;
  initialTab: PanelTab;
  onClose: () => void;
  /** Reloads the connection list and resolves to it. */
  onReload: () => Promise<ClickHouseConnection[]>;
  /** A connection was created: the panel goes on with it. */
  onCreated: (connection: ClickHouseConnection) => void;
}

interface Prompt {
  target: PanelTab | "close";
  saving: boolean;
}

const TAB_TRIGGER_CLASS =
  "rounded-none border-b-2 border-transparent bg-transparent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint shadow-none data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:text-paper data-[state=active]:shadow-none";

const PANELS: readonly PanelTab[] = ["general", "login", "who"];

function isPanelTab(value: string): value is PanelTab {
  return PANELS.some((tab) => tab === value);
}

export function ConnectionPanel({ connection, initialTab, onClose, onReload, onCreated }: ConnectionPanelProps): ReactElement {
  const { isSuperAdmin, roles } = useRbacStore();
  const superAdmin = isSuperAdmin();
  const queryClient = useQueryClient();
  const creating = connection === null;
  const connectionId = connection?.id ?? null;

  const stored = useMemo(() => (connection ? storedLoginOf(connection) : null), [connection]);
  const generalBaseline = useMemo(() => generalDraftFrom(connection), [connection]);
  const loginBaseline = useMemo(() => loginDraftFrom(stored), [stored]);

  const [tab, setTab] = useState<PanelTab>(creating && initialTab === "who" ? "general" : initialTab);
  const [general, setGeneral] = useState<GeneralDraft>(generalBaseline);
  const [login, setLogin] = useState<LoginDraft>(loginBaseline);
  const [nameError, setNameError] = useState<string | null>(null);
  const [whoDirty, setWhoDirty] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);

  const identity = useQuery({
    queryKey: connectionIdentityKey(connectionId ?? ""),
    queryFn: () => getConnectionIdentity(connectionId ?? ""),
    enabled: superAdmin && connectionId !== null,
    retry: false,
  });

  const tabDirty = (which: PanelTab): boolean => {
    // While creating, General and the login are one form: moving between them loses nothing.
    if (creating) return false;
    if (which === "general") return isGeneralDirty(general, generalBaseline);
    if (which === "login") return isLoginDirty(login, loginBaseline);
    return whoDirty;
  };

  const closeDirty = creating ? isGeneralDirty(general, generalBaseline) || isLoginDirty(login, loginBaseline) : tabDirty(tab);

  const go = (target: PanelTab | "close"): void => {
    setPrompt(null);
    if (tab === "who") setWhoDirty(false);
    if (target === "close") onClose();
    else setTab(target);
  };

  const requestTab = (value: string): void => {
    if (!isPanelTab(value) || value === tab) return;
    if (tabDirty(tab)) setPrompt({ target: value, saving: false });
    else setTab(value);
  };

  const requestClose = (): void => {
    if (closeDirty) setPrompt({ target: "close", saving: false });
    else onClose();
  };

  const discard = (): void => {
    if (!prompt) return;
    if (tab === "general") setGeneral(generalBaseline);
    if (tab === "login") setLogin(loginBaseline);
    go(prompt.target);
  };

  const saveAndGo = async (): Promise<void> => {
    if (!prompt) return;
    const target = prompt.target;
    setPrompt({ target, saving: true });
    const saved = saveRef.current ? await saveRef.current() : true;
    // A refused save stays on the tab, where it shows why.
    if (saved) go(target);
    else setPrompt(null);
  };

  const reload = useCallback(async (): Promise<void> => {
    const list = await onReload();
    const fresh = list.find((entry) => entry.id === connectionId);
    if (fresh) {
      setGeneral(generalDraftFrom(fresh));
      setLogin(loginDraftFrom(storedLoginOf(fresh)));
    }
    void queryClient.invalidateQueries({ queryKey: OWN_IDENTITIES_KEY });
    if (connectionId) await queryClient.invalidateQueries({ queryKey: connectionIdentityKey(connectionId) });
  }, [onReload, connectionId, queryClient]);

  const readinessChanged = useCallback((): void => {
    void onReload();
    void queryClient.invalidateQueries({ queryKey: OWN_IDENTITIES_KEY });
    if (connectionId) void queryClient.invalidateQueries({ queryKey: connectionIdentityKey(connectionId) });
  }, [onReload, connectionId, queryClient]);

  const kind = connection ? identityKind(connection.identityMode) : null;
  const loginFailing = connection !== null && kind !== IDENTITY_MODE_SHARED && (kind === "unknown" || connection.identityHealth === "failing");
  const count = connection ? whoCount(connection) : null;
  const promptLabel = prompt?.target === "close" ? "closing" : prompt ? `moving to ${PANEL_TAB_LABELS[prompt.target]}` : "";

  return (
    <Sheet open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <SheetContent className="w-full overflow-y-auto border-ink-500 bg-ink-100 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{connection ? `Edit connection · ${connection.name}` : "New connection"}</SheetTitle>
          <SheetDescription>
            {connection
              ? `${identityKindLabel(connection.identityMode)} · ${connection.host}:${connection.port}`
              : "Name it on General, then set up its ClickHouse login and press Create."}
          </SheetDescription>
        </SheetHeader>

        <Tabs value={tab} onValueChange={requestTab} className="mt-4">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-ink-500 bg-transparent p-0">
            <TabsTrigger value="general" className={TAB_TRIGGER_CLASS}>General</TabsTrigger>
            <TabsTrigger value="login" className={TAB_TRIGGER_CLASS} aria-label={loginFailing ? "ClickHouse login (failing)" : undefined}>
              ClickHouse login
              {loginFailing && <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />}
            </TabsTrigger>
            <TabsTrigger value="who" disabled={creating} title={creating ? "Create the connection first" : undefined} className={TAB_TRIGGER_CLASS}>
              Who can query
              {count && <span className="ml-1.5 text-brand">{count}</span>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="mt-5">
            <GeneralTab
              connection={connection}
              draft={general}
              baseline={generalBaseline}
              onDraftChange={(patch) => {
                setGeneral((current) => ({ ...current, ...patch }));
                if (patch.name !== undefined) setNameError(null);
              }}
              nameError={nameError}
              saveRef={saveRef}
              onSaved={reload}
              onClose={requestClose}
              onNext={() => requestTab("login")}
            />
          </TabsContent>

          <TabsContent value="login" className="mt-5">
            {connection && superAdmin && identity.isPending ? (
              <p className="flex items-center gap-2 text-[12px] text-paper-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Loading
              </p>
            ) : (
              <LoginTab
                connection={connection}
                stored={stored}
                draft={login}
                baseline={loginBaseline}
                onDraftChange={(patch) => setLogin((current) => ({ ...current, ...patch }))}
                general={general}
                onNameMissing={(problem) => {
                  setNameError(problem);
                  setTab("general");
                }}
                superAdmin={superAdmin}
                identity={identity.data ?? null}
                saveRef={saveRef}
                onSaved={reload}
                onCreated={onCreated}
                onKindSwitched={(next) => {
                  // A new role ceiling or personal connection refuses everyone until roles are mapped or people linked.
                  if (next !== IDENTITY_MODE_SHARED) setTab("who");
                }}
              />
            )}
          </TabsContent>

          {connection && (
            <TabsContent value="who" className="mt-5">
              <WhoCanQueryTab
                connection={connection}
                superAdmin={superAdmin}
                viewerRoles={roles}
                onChanged={readinessChanged}
                onDirtyChange={setWhoDirty}
                saveRef={saveRef}
                onFinish={requestClose}
              />
            </TabsContent>
          )}
        </Tabs>

        <Dialog open={prompt !== null} onOpenChange={(open) => { if (!open && !prompt?.saving) setPrompt(null); }}>
          <DialogContent className="rounded-xs border-ink-500 bg-ink-100 sm:max-w-[460px]">
            <DialogHeader>
              <DialogTitle className="text-paper">Unsaved changes on {creating ? "the new connection" : PANEL_TAB_LABELS[tab]}</DialogTitle>
              <DialogDescription className="text-[13px] leading-[1.5] text-paper-muted">
                {creating
                  ? "Nothing is created until you press Create, so closing drops what you typed."
                  : `Each tab saves on its own, so ${promptLabel} drops this change.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button type="button" variant="outline" onClick={() => setPrompt(null)} disabled={prompt?.saving} className={SECONDARY_BUTTON_CLASS}>
                Stay
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={discard} disabled={prompt?.saving} className={SECONDARY_BUTTON_CLASS}>
                  Discard
                </Button>
                {!creating && (
                  <Button type="button" onClick={() => void saveAndGo()} disabled={prompt?.saving} className={PRIMARY_BUTTON_CLASS}>
                    {prompt?.saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                    Save and go
                  </Button>
                )}
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
