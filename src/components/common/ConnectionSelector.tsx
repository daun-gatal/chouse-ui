/**
 * Connection Selector Component
 *
 * Dropdown to select and switch between ClickHouse connections.
 * Automatically connects to ClickHouse when a connection is selected.
 * Persists the selected connection across browser reloads.
 */

import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Server,
  ChevronDown,
  Check,
  RefreshCw,
  AlertCircle,
  Loader2,
  Lock,
  Plug,
  PlugZap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { log } from "@/lib/log";
import { toast } from "sonner";
import {
  rbacConnectionsApi,
  type ClickHouseConnection,
  type ConnectResult,
} from "@/api/rbac";
import { setSessionId, clearSession, getSessionId } from "@/api/client";
import { rbacUserPreferencesApi } from "@/api";
import { useRbacStore, useAuthStore } from "@/stores";

const SELECTED_CONNECTION_KEY = "clickhouse_selected_connection_id";

const TOOLTIP_CLASS =
  "z-[100] rounded-xs border border-ink-500 bg-ink-200 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted shadow-lg";

function getStoredConnectionId(): string | null {
  try {
    return localStorage.getItem(SELECTED_CONNECTION_KEY);
  } catch {
    return null;
  }
}

function setStoredConnectionId(id: string): void {
  try {
    localStorage.setItem(SELECTED_CONNECTION_KEY, id);
  } catch {
    // Ignore storage errors
  }
}

async function getStoredConnectionIdFromDb(): Promise<string | null> {
  try {
    const preferences = await rbacUserPreferencesApi.getPreferences();
    const lastConnectionId = preferences.workspacePreferences?.lastConnectionId as string | undefined;
    return lastConnectionId || null;
  } catch (error) {
    log.error("[ConnectionSelector] Failed to fetch connection preference:", error);
    return getStoredConnectionId();
  }
}

async function setStoredConnectionIdToDb(id: string): Promise<void> {
  try {
    const currentPreferences = await rbacUserPreferencesApi.getPreferences();
    await rbacUserPreferencesApi.updatePreferences({
      workspacePreferences: {
        ...currentPreferences.workspacePreferences,
        lastConnectionId: id,
      },
    });
    setStoredConnectionId(id);
  } catch (error) {
    log.error("[ConnectionSelector] Failed to save connection preference:", error);
    setStoredConnectionId(id);
  }
}

interface ConnectionSelectorProps {
  isCollapsed?: boolean;
  onConnectionChange?: (connection: ClickHouseConnection, session?: ConnectResult) => void;
}

export default function ConnectionSelector({
  isCollapsed = false,
  onConnectionChange,
}: ConnectionSelectorProps) {
  const [connections, setConnections] = useState<ClickHouseConnection[]>([]);
  const [activeConnection, setActiveConnection] = useState<ClickHouseConnection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const hasInitialized = useRef(false);

  const { isAuthenticated } = useRbacStore();
  const queryClient = useQueryClient();

  const fetchConnections = async () => {
    if (!isAuthenticated) return;

    setIsLoading(true);
    try {
      const myConnections = await rbacConnectionsApi.getMyConnections();
      const previousConnectionsCount = connections.length;
      setConnections(myConnections);

      if (!hasInitialized.current) {
        hasInitialized.current = true;

        let storedConnectionId: string | null = null;
        try {
          storedConnectionId = await getStoredConnectionIdFromDb();
        } catch (error) {
          log.error("[ConnectionSelector] Failed to fetch connection preference:", error);
          storedConnectionId = getStoredConnectionId();
        }

        let connectionToUse: ClickHouseConnection | undefined;

        if (storedConnectionId) {
          connectionToUse = myConnections.find((c) => c.id === storedConnectionId);
        }

        if (!connectionToUse) {
          connectionToUse = myConnections.find((c) => c.isDefault) || myConnections[0];
        }

        if (connectionToUse) {
          setActiveConnection(connectionToUse);
          await connectToClickHouse(connectionToUse);
        }
      } else {
        if (!isConnected && !activeConnection && myConnections.length > 0) {
          const connectionToUse = myConnections.find((c) => c.isDefault) || myConnections[0];
          if (connectionToUse) {
            setActiveConnection(connectionToUse);
            await connectToClickHouse(connectionToUse);
          }
        } else if (previousConnectionsCount === 0 && myConnections.length > 0 && !isConnected) {
          const connectionToUse = myConnections.find((c) => c.isDefault) || myConnections[0];
          if (connectionToUse) {
            setActiveConnection(connectionToUse);
            await connectToClickHouse(connectionToUse);
          }
        }
      }
    } catch (error) {
      log.error("Failed to fetch connections:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const connectToClickHouse = async (connection: ClickHouseConnection) => {
    setIsConnecting(true);
    try {
      const result = await rbacConnectionsApi.connect(connection.id);

      setSessionId(result.sessionId);

      const protocol = connection.sslEnabled ? "https" : "http";
      const connectionUrl = `${protocol}://${connection.host}:${connection.port}`;

      useAuthStore.getState().setConnectionInfo({
        sessionId: result.sessionId,
        username: result.username,
        url: connectionUrl,
        version: result.version,
        isAdmin: result.isAdmin,
        permissions: result.permissions,
        activeConnectionId: connection.id,
        activeConnectionName: connection.name,
      });

      await setStoredConnectionIdToDb(connection.id);

      setIsConnected(true);
      onConnectionChange?.(connection, result);
      toast.success(`Connected to "${connection.name}" (v${result.version})`);

      queryClient.invalidateQueries({ queryKey: ["databases"] });
      queryClient.invalidateQueries({ queryKey: ["tableDetails"] });
      queryClient.invalidateQueries({ queryKey: ["tableSample"] });
      queryClient.invalidateQueries({ queryKey: ["systemStats"] });
      queryClient.invalidateQueries({ queryKey: ["recentQueries"] });
      queryClient.invalidateQueries({ queryKey: ["queryLogs"] });
      queryClient.invalidateQueries({ queryKey: ["metrics"] });
      queryClient.invalidateQueries({ queryKey: ["productionMetrics"] });
      queryClient.invalidateQueries({ queryKey: ["savedQueries"] });

      window.dispatchEvent(new CustomEvent("clickhouse:connected", { detail: result }));

      return result;
    } catch (error) {
      log.error("Failed to connect:", error);
      setIsConnected(false);
      clearSession();
      toast.error(`Failed to connect to "${connection.name}"`);
      throw error;
    } finally {
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) {
      hasInitialized.current = false;
      setConnections([]);
      setActiveConnection(null);
      setIsConnected(false);
      return;
    }

    fetchConnections();

    const existingSession = getSessionId();
    if (existingSession) {
      setIsConnected(true);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const interval = setInterval(() => {
      if (!isConnected && !activeConnection) {
        fetchConnections();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isAuthenticated, isConnected, activeConnection]);

  const handleSelectConnection = async (connection: ClickHouseConnection) => {
    if (activeConnection?.id === connection.id && isConnected) {
      setIsOpen(false);
      return;
    }

    setActiveConnection(connection);
    setIsOpen(false);

    if (isConnected) {
      try {
        await rbacConnectionsApi.disconnect(getSessionId() || undefined);
        clearSession();
        setIsConnected(false);
      } catch (error) {
        log.error("Failed to disconnect:", error);
      }
    }

    await connectToClickHouse(connection);
  };

  // ── Loading or connecting ──────────────────────────────────────────────
  if (isLoading || isConnecting) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-xs border border-ink-500 bg-ink-200 px-2.5 py-1.5",
          isCollapsed && "h-9 w-9 justify-center px-0 py-0"
        )}
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-paper-dim" aria-hidden />
        {!isCollapsed && (
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted">
            {isConnecting ? "Connecting…" : "Loading…"}
          </span>
        )}
      </div>
    );
  }

  // ── No connections ─────────────────────────────────────────────────────
  if (connections.length === 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "flex items-center gap-2 rounded-xs border border-brand/30 bg-brand/[0.04] px-2.5 py-1.5",
              isCollapsed && "h-9 w-9 justify-center px-0 py-0"
            )}
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
            {!isCollapsed && (
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-brand">
                No connection
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" className={TOOLTIP_CLASS}>
          No ClickHouse connections configured.
        </TooltipContent>
      </Tooltip>
    );
  }

  // ── Status helpers ─────────────────────────────────────────────────────
  const statusDot = isConnected ? "bg-emerald-400" : "bg-paper-faint";
  const statusIcon = isConnected ? PlugZap : Plug;
  const StatusIcon = statusIcon;

  // ── Single connection (no dropdown) ────────────────────────────────────
  if (connections.length === 1) {
    const conn = connections[0];

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => !isConnected && connectToClickHouse(conn)}
            className={cn(
              "group flex items-center gap-2 rounded-xs border border-ink-500 bg-ink-100 transition-colors",
              !isConnected && "cursor-pointer hover:border-ink-700 hover:bg-ink-200",
              isCollapsed ? "h-9 w-9 justify-center" : "w-full px-2.5 py-1.5"
            )}
            aria-label={`Connection: ${conn.name}`}
          >
            <div className="relative shrink-0">
              <StatusIcon className="h-3.5 w-3.5 text-paper-muted" aria-hidden />
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-ink-100",
                  statusDot
                )}
                aria-hidden
              />
            </div>
            {!isCollapsed && (
              <div className="flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate text-[12px] font-medium text-paper">{conn.name}</span>
                <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  {isConnected ? "Connected" : "Click to connect"}
                </span>
              </div>
            )}
          </button>
        </TooltipTrigger>
        {isCollapsed && (
          <TooltipContent side="right" className={TOOLTIP_CLASS}>
            {conn.name} · {isConnected ? "Connected" : "Click to connect"}
          </TooltipContent>
        )}
      </Tooltip>
    );
  }

  // ── Multiple connections (dropdown) ────────────────────────────────────
  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "h-auto justify-between rounded-xs border border-ink-500 bg-ink-100 px-2.5 py-1.5 transition-colors hover:border-ink-700 hover:bg-ink-200",
            isCollapsed ? "h-9 w-9 justify-center px-0 py-0" : "w-full"
          )}
          aria-label="Switch connection"
        >
          <div className={cn("flex min-w-0 items-center gap-2", isCollapsed && "justify-center")}>
            <div className="relative shrink-0">
              <StatusIcon className="h-3.5 w-3.5 text-paper-muted" aria-hidden />
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-ink-100",
                  statusDot
                )}
                aria-hidden
              />
            </div>
            {!isCollapsed && activeConnection && (
              <div className="flex min-w-0 flex-col text-left">
                <span className="truncate text-[12px] font-medium text-paper">
                  {activeConnection.name}
                </span>
                <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  {isConnected ? "Connected" : "Not connected"}
                </span>
              </div>
            )}
          </div>
          {!isCollapsed && <ChevronDown className="h-3.5 w-3.5 shrink-0 text-paper-dim" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="z-[100] w-72 rounded-md border-ink-500 bg-ink-100 p-0"
        align={isCollapsed ? "start" : "center"}
        side={isCollapsed ? "right" : "bottom"}
        sideOffset={isCollapsed ? 8 : 4}
      >
        <DropdownMenuLabel className="border-b border-ink-500 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          Switch connection
        </DropdownMenuLabel>

        <div className="flex flex-col py-1">
          {connections.map((conn) => {
            const isCurrent = activeConnection?.id === conn.id;
            return (
              <DropdownMenuItem
                key={conn.id}
                onClick={() => handleSelectConnection(conn)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xs px-3 py-2 transition-colors hover:bg-ink-200",
                  isCurrent && "bg-ink-200"
                )}
              >
                <div className="relative shrink-0">
                  <Server className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
                  {conn.sslEnabled && (
                    <Lock
                      className="absolute -bottom-0.5 -right-0.5 h-2 w-2 text-emerald-400"
                      aria-hidden
                    />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-paper">{conn.name}</span>
                    {conn.isDefault && (
                      <span className="inline-flex items-center rounded-xs border border-brand/40 px-1 py-px font-mono text-[9px] uppercase tracking-[0.14em] text-brand">
                        Default
                      </span>
                    )}
                  </div>
                  <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                    {conn.username}
                  </span>
                </div>
                {isCurrent && <Check className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />}
              </DropdownMenuItem>
            );
          })}
        </div>

        <DropdownMenuSeparator className="bg-ink-500" />
        <DropdownMenuItem
          onClick={fetchConnections}
          className="flex cursor-pointer items-center gap-2 rounded-xs px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Refresh
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
