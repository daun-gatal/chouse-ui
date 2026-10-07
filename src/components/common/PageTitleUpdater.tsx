import { useEffect } from "react";
import { useLocation } from "react-router";

/**
 * Mapping of route paths to page titles.
 * Routes are matched from most specific to least specific.
 */
const ROUTE_TITLES: Record<string, string> = {
    "/admin/users/create": "Create User",
    "/admin/users/edit": "Edit User",
    "/admin": "Admin",
    "/overview": "Overview",
    "/monitoring": "Monitoring",
    "/explorer": "Explorer",
    "/data": "Data",
    "/fleet": "Fleet",
    "/doctor": "Doctor",
    "/ai": "AI Governance",
    "/preferences": "Preferences",
    "/login": "Login",
};

/** Matches whole path segments so "/ai" never claims e.g. "/aim" or "/data" claim "/dataops". */
function matchesRoute(pathname: string, route: string): boolean {
    return pathname === route || pathname.startsWith(`${route}/`);
}

export function getPageTitle(pathname: string): string {
    const match = Object.entries(ROUTE_TITLES).find(([route]) => matchesRoute(pathname, route));
    return `CHouse UI | ${match ? match[1] : "Home"}`;
}

/**
 * Component that updates the document title based on the current route.
 * Should be placed inside the Router component.
 */
export function PageTitleUpdater(): null {
    const location = useLocation();

    useEffect(() => {
        document.title = getPageTitle(location.pathname);
    }, [location.pathname]);

    return null;
}
