import React from "react";
import { useAuthStore, hasPermission } from "@/stores";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface PermissionGuardProps {
  requiredPermission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  showTooltip?: boolean;
}

const PermissionGuard: React.FC<PermissionGuardProps> = ({
  requiredPermission,
  children,
  fallback = null,
  showTooltip = false,
}) => {
  const authState = useAuthStore();
  const permitted = hasPermission(authState, requiredPermission);

  if (permitted) {
    return <>{children}</>;
  }

  if (showTooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="opacity-50 pointer-events-none grayscale">
              {children}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>You do not have permission to perform this action.</p>
            <p className="text-xs text-gray-400">Required: {requiredPermission}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return <>{fallback}</>;
};

export default PermissionGuard;
