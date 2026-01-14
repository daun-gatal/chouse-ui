/**
 * Connection Selector Component
 * 
 * Dropdown to select and switch between ClickHouse connections.
 * Automatically connects to ClickHouse when a connection is selected.
 * Persists the selected connection across browser reloads.
 */

import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  rbacConnectionsApi,
  type ClickHouseConnection,
  type ConnectResult,
} from '@/api/rbac';
import { setSessionId, clearSession, getSessionId } from '@/api/client';
import { rbacUserPreferencesApi } from '@/api';
import { useRbacStore, useAuthStore } from '@/stores';

// Storage key for persisting selected connection (fallback for non-authenticated users)
const SELECTED_CONNECTION_KEY = 'clickhouse_selected_connection_id';

// Helper to get/set selected connection from localStorage (fallback)
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

function clearStoredConnectionId(): void {
  try {
    localStorage.removeItem(SELECTED_CONNECTION_KEY);
  } catch {
    // Ignore storage errors
  }
}

// Get connection ID from database preferences
async function getStoredConnectionIdFromDb(): Promise<string | null> {
  try {
    const preferences = await rbacUserPreferencesApi.getPreferences();
    const lastConnectionId = preferences.workspacePreferences?.lastConnectionId as string | undefined;
    return lastConnectionId || null;
  } catch (error) {
    console.error('[ConnectionSelector] Failed to fetch connection preference:', error);
    // Fallback to localStorage
    return getStoredConnectionId();
  }
}

// Save connection ID to database preferences
async function setStoredConnectionIdToDb(id: string): Promise<void> {
  try {
    // Get current preferences and merge lastConnectionId
    const currentPreferences = await rbacUserPreferencesApi.getPreferences();
    await rbacUserPreferencesApi.updatePreferences({
      workspacePreferences: {
        ...currentPreferences.workspacePreferences,
        lastConnectionId: id,
      },
    });
    // Also update localStorage as fallback
    setStoredConnectionId(id);
  } catch (error) {
    console.error('[ConnectionSelector] Failed to save connection preference:', error);
    // Fallback to localStorage
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

      // If this is the first time initializing, try to auto-connect
      if (!hasInitialized.current) {
        hasInitialized.current = true;

        // Try to restore previously selected connection from database
        let storedConnectionId: string | null = null;
        try {
          storedConnectionId = await getStoredConnectionIdFromDb();
        } catch (error) {
          console.error('[ConnectionSelector] Failed to fetch connection preference:', error);
          // Fallback to localStorage
          storedConnectionId = getStoredConnectionId();
        }

        let connectionToUse: ClickHouseConnection | undefined;

        if (storedConnectionId) {
          // Find the stored connection
          connectionToUse = myConnections.find(c => c.id === storedConnectionId);
        }

        // Fall back to default connection, then first available
        if (!connectionToUse) {
          connectionToUse = myConnections.find(c => c.isDefault) || myConnections[0];
        }

        if (connectionToUse) {
          setActiveConnection(connectionToUse);
          // Auto-connect to selected connection
          await connectToClickHouse(connectionToUse);
        }
      } else {
        // Already initialized - check if we should auto-connect to a new first connection
        // This handles the case where the first connection is created after the component has loaded
        if (!isConnected && !activeConnection && myConnections.length > 0) {
          // We have connections but no active connection - auto-connect to first/default
          const connectionToUse = myConnections.find(c => c.isDefault) || myConnections[0];
          if (connectionToUse) {
            setActiveConnection(connectionToUse);
            await connectToClickHouse(connectionToUse);
          }
        } else if (previousConnectionsCount === 0 && myConnections.length > 0 && !isConnected) {
          // First connection was just added - auto-connect to it
          const connectionToUse = myConnections.find(c => c.isDefault) || myConnections[0];
          if (connectionToUse) {
            setActiveConnection(connectionToUse);
            await connectToClickHouse(connectionToUse);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch connections:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Connect to ClickHouse using the saved connection
  const connectToClickHouse = async (connection: ClickHouseConnection) => {
    setIsConnecting(true);
    try {
      const result = await rbacConnectionsApi.connect(connection.id);

      // Store session ID for API calls
      setSessionId(result.sessionId);

      // Build connection URL for display
      const protocol = connection.sslEnabled ? 'https' : 'http';
      const connectionUrl = `${protocol}://${connection.host}:${connection.port}`;

      // Update auth store with connection information
      useAuthStore.setState({
        username: result.username,
        url: connectionUrl,
        version: result.version,
        isAdmin: result.isAdmin,
        permissions: result.permissions,
        sessionId: result.sessionId,
      });

      // Persist the selected connection to database (and localStorage as fallback)
      await setStoredConnectionIdToDb(connection.id);

      setIsConnected(true);
      onConnectionChange?.(connection, result);
      toast.success(`Connected to "${connection.name}" (v${result.version})`);

      // Invalidate cached queries to ensure fresh data with new connection's permissions
      queryClient.invalidateQueries({ queryKey: ['databases'] });
      queryClient.invalidateQueries({ queryKey: ['tableDetails'] });
      queryClient.invalidateQueries({ queryKey: ['tableSample'] });
      queryClient.invalidateQueries({ queryKey: ['systemStats'] });
      queryClient.invalidateQueries({ queryKey: ['recentQueries'] });
      queryClient.invalidateQueries({ queryKey: ['queryLogs'] });

      // Trigger a refresh of data by dispatching a custom event
      window.dispatchEvent(new CustomEvent('clickhouse:connected', { detail: result }));

      return result;
    } catch (error) {
      console.error('Failed to connect:', error);
      setIsConnected(false);
      clearSession();
      // Don't clear stored connection on error - user might want to retry
      toast.error(`Failed to connect to "${connection.name}"`);
      throw error;
    } finally {
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    // Reset initialization flag when auth status changes (e.g., logout/login)
    if (!isAuthenticated) {
      hasInitialized.current = false;
      setConnections([]);
      setActiveConnection(null);
      setIsConnected(false);
      return;
    }

    fetchConnections();

    // Check if we have an existing session
    const existingSession = getSessionId();
    if (existingSession) {
      setIsConnected(true);
    }
  }, [isAuthenticated]);

  // Listen for connection changes (e.g., when a new connection is created)
  useEffect(() => {
    if (!isAuthenticated) return;

    // Poll for connection updates periodically (every 3 seconds) when not connected
    // This ensures we detect when a new connection is added and auto-connect to it
    const interval = setInterval(() => {
      // Only refresh if we're not connected and have no active connection
      // This prevents unnecessary refreshes when already connected
      if (!isConnected && !activeConnection) {
        fetchConnections();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isAuthenticated, isConnected, activeConnection]);

  const handleSelectConnection = async (connection: ClickHouseConnection) => {
    // Don't re-connect if already connected to this connection
    if (activeConnection?.id === connection.id && isConnected) {
      setIsOpen(false);
      return;
    }

    setActiveConnection(connection);
    setIsOpen(false);

    // Disconnect from previous connection
    if (isConnected) {
      try {
        await rbacConnectionsApi.disconnect(getSessionId() || undefined);
        clearSession();
        setIsConnected(false);
      } catch (error) {
        console.error('Failed to disconnect:', error);
      }
    }

    // Connect to new connection
    await connectToClickHouse(connection);
  };

  // Loading or connecting state
  if (isLoading || isConnecting) {
    return (
      <div className={cn(
        "flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 px-3 py-2",
        isCollapsed && "justify-center p-2"
      )}>
        <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
        {!isCollapsed && (
          <span className="text-sm text-gray-400">
            {isConnecting ? 'Connecting...' : 'Loading...'}
          </span>
        )}
      </div>
    );
  }

  // No connections
  if (connections.length === 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(
            "flex items-center gap-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2",
            isCollapsed && "justify-center p-2"
          )}>
            <AlertCircle className="w-4 h-4 text-yellow-400" />
            {!isCollapsed && (
              <span className="text-sm text-yellow-300">No connections</span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          No ClickHouse connections configured. Add one in Administration.
        </TooltipContent>
      </Tooltip>
    );
  }

  // Single connection (no dropdown needed)
  if (connections.length === 1) {
    const conn = connections[0];
    const statusColor = isConnected ? 'text-green-400' : 'text-yellow-400';
    const statusBgColor = isConnected ? 'bg-green-400' : 'bg-yellow-400';

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => !isConnected && connectToClickHouse(conn)}
            className={cn(
              "flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 px-3 py-2 w-full",
              !isConnected && "hover:bg-white/10 cursor-pointer",
              isCollapsed && "justify-center p-2"
            )}
          >
            <div className="relative">
              {isConnected ? (
                <PlugZap className={cn("w-4 h-4", statusColor)} />
              ) : (
                <Plug className={cn("w-4 h-4", statusColor)} />
              )}
              <span className={cn("absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-black", statusBgColor)} />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col min-w-0 flex-1 text-left">
                <span className="text-sm font-medium text-white truncate">
                  {conn.name}
                </span>
                <span className="text-xs text-gray-500 truncate">
                  {isConnected ? `Connected · ${conn.host}` : `Click to connect · ${conn.host}`}
                </span>
              </div>
            )}
          </button>
        </TooltipTrigger>
        {isCollapsed && (
          <TooltipContent side="right">
            {conn.name} ({isConnected ? 'Connected' : 'Click to connect'})
          </TooltipContent>
        )}
      </Tooltip>
    );
  }

  // Multiple connections - show dropdown
  const statusColor = isConnected ? 'text-green-400' : 'text-yellow-400';
  const statusBgColor = isConnected ? 'bg-green-400' : 'bg-yellow-400';

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-between rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 px-3 py-2 h-auto",
            isCollapsed && "justify-center p-2"
          )}
        >
          <div className={cn("flex items-center gap-2 min-w-0", isCollapsed && "justify-center")}>
            <div className="relative shrink-0">
              {isConnected ? (
                <PlugZap className={cn("w-4 h-4", statusColor)} />
              ) : (
                <Plug className={cn("w-4 h-4", statusColor)} />
              )}
              <span className={cn("absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-black", statusBgColor)} />
            </div>
            {!isCollapsed && activeConnection && (
              <div className="flex flex-col min-w-0 text-left">
                <span className="text-sm font-medium text-white truncate">
                  {activeConnection.name}
                </span>
                <span className="text-xs text-gray-500 truncate">
                  {isConnected ? `Connected · ${activeConnection.host}` : 'Not connected'}
                </span>
              </div>
            )}
          </div>
          {!isCollapsed && <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-64 bg-gray-900 border-gray-800"
        align={isCollapsed ? "start" : "center"}
        side={isCollapsed ? "right" : "bottom"}
      >
        <DropdownMenuLabel className="text-gray-400 text-xs">
          Switch Connection
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-gray-800" />

        {connections.map((conn) => (
          <DropdownMenuItem
            key={conn.id}
            onClick={() => handleSelectConnection(conn)}
            className={cn(
              "flex items-center gap-3 cursor-pointer",
              activeConnection?.id === conn.id && "bg-purple-500/10"
            )}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="relative shrink-0">
                <Server className="w-4 h-4 text-gray-400" />
                {conn.sslEnabled && (
                  <Lock className="w-2 h-2 absolute -bottom-0.5 -right-0.5 text-green-400" />
                )}
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white truncate">
                    {conn.name}
                  </span>
                  {conn.isDefault && (
                    <Badge className="bg-yellow-500/20 text-yellow-400 text-[10px] px-1 py-0">
                      Default
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-gray-500 truncate">
                  {conn.username}@{conn.host}:{conn.port}
                </span>
              </div>
            </div>
            {activeConnection?.id === conn.id && (
              <Check className="w-4 h-4 text-purple-400 shrink-0" />
            )}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator className="bg-gray-800" />
        <DropdownMenuItem
          onClick={fetchConnections}
          className="flex items-center gap-2 text-gray-400 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
