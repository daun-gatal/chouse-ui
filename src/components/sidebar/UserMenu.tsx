import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LogOut } from "lucide-react";
import { useRbacStore } from "@/stores";
import { useNavigate } from "react-router-dom";
import { getSessionId, clearSession } from "@/api/client";
import { rbacConnectionsApi } from "@/api/rbac";
import ConfirmationDialog from "@/components/common/ConfirmationDialog";
import { log } from "@/lib/log";

interface UserMenuProps {
  isCollapsed: boolean;
}

const TOOLTIP_CLASS =
  "z-[100] rounded-xs border border-ink-500 bg-ink-200 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted shadow-lg";

export default function UserMenu({ isCollapsed }: UserMenuProps) {
  const navigate = useNavigate();
  const { user, logout } = useRbacStore();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const sessionId = getSessionId();
      if (sessionId) {
        try {
          await rbacConnectionsApi.disconnect(sessionId);
        } catch (error) {
          log.error("Failed to disconnect ClickHouse connection:", error);
        }
      }
      await logout();
      clearSession();
    } catch (error) {
      log.error("Logout error:", error);
      clearSession();
    } finally {
      setIsLoggingOut(false);
      navigate("/login");
    }
  };

  const displayName = user?.displayName || user?.username || "User";
  const userInitials = displayName
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <>
      <ConfirmationDialog
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
        title="Log out"
        description="Are you sure you want to log out?"
        confirmText={isLoggingOut ? "Logging out…" : "Log out"}
        cancelText="Cancel"
        variant="danger"
      />

      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
              className={cn(
                "group flex w-full items-center rounded-xs border border-transparent p-1.5 transition-colors",
                isCollapsed
                  ? "justify-center hover:bg-ink-200"
                  : "justify-start gap-3 hover:border-ink-500 hover:bg-ink-200"
              )}
              aria-label="User menu"
            >
              <div className="relative shrink-0">
                <span className="grid h-8 w-8 place-items-center rounded-xs border border-ink-500 bg-ink-200 font-mono text-[11px] font-semibold tracking-tight text-paper">
                  {userInitials}
                </span>
                <span
                  className="absolute -bottom-px -right-px h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-ink-50"
                  aria-hidden
                />
              </div>

              {!isCollapsed && (
                <div className="flex flex-1 flex-col overflow-hidden text-left">
                  <span
                    className="truncate text-[13px] font-medium text-paper"
                    title={displayName}
                  >
                    {displayName}
                  </span>
                  <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                    {user?.email || `@${user?.username}`}
                  </span>
                </div>
              )}

              {!isCollapsed && (
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-xs text-paper-faint transition-colors group-hover:text-red-400">
                  <LogOut className="h-3.5 w-3.5" aria-hidden />
                </span>
              )}
            </button>
          </TooltipTrigger>

          {isCollapsed && (
            <TooltipContent side="right" align="center" sideOffset={10} className={TOOLTIP_CLASS}>
              <div className="flex flex-col gap-0.5 normal-case tracking-normal">
                <span className="text-[12px] font-medium text-paper">{displayName}</span>
                <span className="font-mono text-[10px] text-paper-faint">
                  {user?.email || `@${user?.username}`}
                </span>
                <span className="mt-1 inline-flex items-center gap-1.5 border-t border-ink-500 pt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-red-400">
                  <LogOut className="h-3 w-3" />
                  Click to log out
                </span>
              </div>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    </>
  );
}
