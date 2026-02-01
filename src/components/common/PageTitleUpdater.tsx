import { useEffect } from "react";
import { useLocation } from "react-router-dom";

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
    "/settings": "Settings",
    "/login": "Login",
};

/**
 * Component that updates the document title based on the current route.
 * Should be placed inside the Router component.
 */
export function PageTitleUpdater() {
    const location = useLocation();

    useEffect(() => {
        const pathname = location.pathname;

        // Find the matching route title (check more specific paths first)
        let pageTitle = "Home";
        for (const [route, title] of Object.entries(ROUTE_TITLES)) {
            if (pathname.startsWith(route)) {
                pageTitle = title;
                break;
            }
        }

        document.title = `CHouse UI | ${pageTitle}`;
    }, [location.pathname]);

    return null;
}
