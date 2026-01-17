import React from "react";
import { useRbacStore } from "@/stores";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface PermissionGuardProps {
  requiredPermission: string; // RBAC permission (e.g., "table:alter", "database:create")
  children: React.ReactNode;
  fallback?: React.ReactNode;
  showTooltip?: boolean;
}

/**
 * PermissionGuard Component
 * 
 * Guards UI elements based on RBAC permissions.
 * Only RBAC-authenticated users can access protected features.
 */
const PermissionGuard: React.FC<PermissionGuardProps> = ({
  requiredPermission,
  children,
  fallback = null,
  showTooltip = false,
}) => {
  const rbacStore = useRbacStore();
  
  // RBAC authentication is required
  if (!rbacStore.isAuthenticated) {
    return <>{fallback}</>;
  }
  
  // Check if user has the required permission
  const permitted = rbacStore.hasPermission(requiredPermission);

  if (permitted) {
    return <>{children}</>;
  }

  if (showTooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className="opacity-50 pointer-events-none grayscale"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
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
