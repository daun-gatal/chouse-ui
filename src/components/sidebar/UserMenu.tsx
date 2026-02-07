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

interface UserMenuProps {
    isCollapsed: boolean;
}

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
                    console.error("Failed to disconnect ClickHouse connection:", error);
                }
            }
            await logout();
            clearSession();
        } catch (error) {
            console.error("Logout error:", error);
            clearSession();
        } finally {
            setIsLoggingOut(false);
            navigate("/login");
        }
    };

    const displayName = user?.displayName || user?.username || "User";
    const userInitials = displayName.slice(0, 2).toUpperCase();

    return (
        <>
            <ConfirmationDialog
                isOpen={showLogoutConfirm}
                onClose={() => setShowLogoutConfirm(false)}
                onConfirm={handleLogout}
                title="Log out"
                description="Are you sure you want to log out?"
                confirmText={isLoggingOut ? "Logging out..." : "Log out"}
                cancelText="Cancel"
                variant="danger"
            />

            <TooltipProvider delayDuration={0}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            onClick={() => setShowLogoutConfirm(true)}
                            className={cn(
                                "flex items-center rounded-xl p-2 transition-all duration-300 group outline-none border border-transparent w-full",
                                isCollapsed
                                    ? "justify-center hover:bg-white/10"
                                    : "justify-start bg-white/5 hover:bg-white/10"
                            )}
                        >
                            <div className="relative shrink-0">
                                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center ring-1 ring-white/10 font-semibold text-sm text-white shadow-lg shadow-purple-500/20 group-hover:scale-105 transition-transform duration-200">
                                    {userInitials}
                                </div>
                                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-[#121212] flex items-center justify-center">
                                </div>
                            </div>

                            {!isCollapsed && (
                                <div className="ml-3 flex flex-col items-start overflow-hidden text-left flex-1">
                                    <span className="text-sm font-medium text-white truncate w-full" title={displayName}>
                                        {displayName}
                                    </span>
                                    <span className="text-xs text-gray-400 truncate w-full">
                                        {user?.email || `@${user?.username}`}
                                    </span>
                                </div>
                            )}

                            {!isCollapsed && (
                                <div className="ml-2 p-1.5 rounded-lg text-gray-400 group-hover:text-red-400 group-hover:bg-red-500/10 transition-colors">
                                    <LogOut className="h-4 w-4" />
                                </div>
                            )}
                        </button>
                    </TooltipTrigger>

                    {isCollapsed && (
                        <TooltipContent
                            side="right"
                            align="center"
                            sideOffset={10}
                            className="bg-black/90 backdrop-blur-xl border-white/10 text-gray-200 p-3"
                        >
                            <div className="flex flex-col gap-1">
                                <span className="font-medium text-white">{displayName}</span>
                                <span className="text-xs text-gray-400">{user?.email || `@${user?.username}`}</span>
                                <div className="flex items-center gap-1.5 text-xs text-red-400 font-medium mt-1 pt-1 border-t border-white/10">
                                    <LogOut className="h-3 w-3" />
                                    <span>Click to log out</span>
                                </div>
                            </div>
                        </TooltipContent>
                    )}
                </Tooltip>
            </TooltipProvider>
        </>
    );
}

