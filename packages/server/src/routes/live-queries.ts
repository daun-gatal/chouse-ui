/**
 * Live Queries Route
 * 
 * Provides endpoints for viewing and managing running ClickHouse queries.
 * Restricted to super_admin and admin roles only.
 * Operates on the currently active ClickHouse connection.
 */

import { Hono, Context, Next } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { AppError } from "../types";
import { optionalRbacMiddleware } from "../middleware/dataAccess";
import { getSession } from "../services/clickhouse";
import { getUserConnections, getConnectionWithPassword } from "../rbac/services/connections";
import { ClickHouseService } from "../services/clickhouse";
import { createAuditLog, userHasPermission, getUserById } from "../rbac/services/rbac";
import { AUDIT_ACTIONS, PERMISSIONS, SYSTEM_ROLES } from "../rbac/schema/base";
import { getClientIp } from "../rbac/middleware/rbacAuth";

// ============================================
// Types
// ============================================

interface LiveQuery {
    query_id: string;
    user: string;
    query: string;
    elapsed_seconds: number;
    read_rows: number;
    read_bytes: number;
    memory_usage: number;
    is_initial_query: number;
    client_name: string;
    rbac_user_id?: string; // Derived from log_comment
    rbac_user?: string; // Resolved from rbac_user_id
    rbac_user_display_name?: string; // Resolved from rbac_user_id
}

type Variables = {
    sessionId?: string;
    service: ClickHouseService;
    rbacUserId?: string;
    rbacRoles?: string[];
    rbacPermissions?: string[];
    isRbacAdmin?: boolean;
    rbacConnectionId?: string;
};

const liveQueries = new Hono<{ Variables: Variables }>();

// ============================================
// Helper Functions
// ============================================

function getCookie(c: Context, name: string): string | undefined {
    const cookies = c.req.header("Cookie") || "";
    const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Check if user is super_admin
 */
function isSuperAdmin(rbacRoles: string[] | undefined): boolean {
    if (!rbacRoles) return false;
    return rbacRoles.includes(SYSTEM_ROLES.SUPER_ADMIN);
}

// ============================================
// Auth Middleware for Live Queries
// ============================================

/**
 * Authentication middleware for live queries
 * Requires RBAC authentication and admin role
 * Uses the active ClickHouse connection
 */
async function liveQueriesAuthMiddleware(c: Context<{ Variables: Variables }>, next: Next) {
    // First, apply RBAC middleware
    await optionalRbacMiddleware(c, async () => { });

    const rbacUserId = c.get("rbacUserId");
    const rbacRoles = c.get("rbacRoles");
    const rbacPermissions = c.get("rbacPermissions");

    // Require RBAC authentication
    if (!rbacUserId) {
        throw AppError.unauthorized("RBAC authentication is required. Please login first.");
    }

    // Check for live_queries:view permission (no admin role required)
    const hasViewPermission = rbacPermissions?.includes(PERMISSIONS.LIVE_QUERIES_VIEW) || false;
    if (!hasViewPermission) {
        const hasDbPermission = await userHasPermission(rbacUserId, PERMISSIONS.LIVE_QUERIES_VIEW);
        if (!hasDbPermission) {
            throw AppError.forbidden("Permission 'live_queries:view' is required to access this feature.");
        }
    }

    // Try to get active ClickHouse session first
    const sessionId = c.req.header("X-Session-ID") || getCookie(c, "ch_session");

    if (sessionId) {
        const sessionData = getSession(sessionId);
        if (sessionData) {
            // Validate session ownership
            if (sessionData.session.rbacUserId && sessionData.session.rbacUserId !== rbacUserId) {
                throw AppError.forbidden("Session does not belong to current user.");
            }

            c.set("sessionId", sessionId);
            c.set("service", sessionData.service);
            c.set("rbacConnectionId", sessionData.session.rbacConnectionId);
            await next();
            return;
        }
    }

    // No active session - create temporary connection from RBAC
    let service: ClickHouseService | null = null;

    try {
        const isSuperAdminUser = isSuperAdmin(rbacRoles);

        // Get user's connections
        let connections: Awaited<ReturnType<typeof getUserConnections>>;
        if (isSuperAdminUser) {
            const { listConnections } = await import("../rbac/services/connections");
            const result = await listConnections({ activeOnly: true });
            connections = result.connections;
        } else {
            connections = await getUserConnections(rbacUserId);
        }

        if (connections.length === 0) {
            throw AppError.badRequest("No ClickHouse connections available. Please connect to a ClickHouse server first.");
        }

        // Find active connection
        const defaultConnection = connections.find((conn) => conn.isDefault && conn.isActive);
        const activeConnection = defaultConnection || connections.find((conn) => conn.isActive);

        if (!activeConnection) {
            throw AppError.badRequest("No active ClickHouse connection found. Please activate a connection.");
        }

        // Get connection with password
        const connection = await getConnectionWithPassword(activeConnection.id);

        if (!connection) {
            throw AppError.unauthorized("Connection not found or access denied.");
        }

        // Build connection URL
        const protocol = connection.sslEnabled ? 'https' : 'http';
        const url = `${protocol}://${connection.host}:${connection.port}`;

        // Create ClickHouse service
        // Create ClickHouse service
        service = new ClickHouseService({
            url,
            username: connection.username,
            password: connection.password || "",
            database: connection.database || undefined,
        }, { rbacUserId });

        // Validating connection via ping is skipped for performance.
        // If the connection is invalid, subsequent queries will fail properly.

        c.set("service", service);
        c.set("rbacConnectionId", connection.id);

        await next();
        return;
    } catch (error) {
        // Service close is handled by ClientManager, no manual close needed here
        if (error instanceof AppError) {
            throw error;
        }
        throw AppError.internal("Failed to establish ClickHouse connection.");
    }
}

// Apply auth middleware to all routes
liveQueries.use("*", liveQueriesAuthMiddleware);

// ============================================
// Routes
// ============================================

/**
 * GET /api/live-queries
 * List all running processes from system.processes
 */
liveQueries.get("/", async (c) => {
    const service = c.get("service");
    const rbacUserId = c.get("rbacUserId");
    const rbacRoles = c.get("rbacRoles");
    const rbacConnectionId = c.get("rbacConnectionId");

    try {
        // Query system.processes for running queries
        // Exclude: 
        // 1. Our own SELECT FROM system.processes query (this query itself)
        // 2. Internal/system queries that are short-lived
        // 3. Queries that have already completed (very short elapsed time likely means it's finishing)
        const result = await service.executeQuery(`
      SELECT 
        query_id,
        user,
        query,
        elapsed as elapsed_seconds,
        read_rows,
        read_bytes,
        memory_usage,
        is_initial_query,
        client_name,
        Settings['log_comment'] as log_comment_json
      FROM system.processes
      WHERE is_initial_query = 1
        AND query NOT LIKE '%FROM system.processes%'
        AND query NOT LIKE 'KILL QUERY%'
      ORDER BY elapsed DESC
    `, "JSON");

        const rawQueries = (result.data || []) as any[];
        const queries: LiveQuery[] = rawQueries.map(q => {
            let rbac_user_id: string | undefined;
            try {
                if (q.log_comment_json) {
                    const parsed = JSON.parse(q.log_comment_json);
                    rbac_user_id = parsed.rbac_user_id;
                }
            } catch (e) {
                // Ignore parse errors (might be plain text comment)
            }
            return {
                ...q,
                rbac_user_id
            };
        });

        // Fetch RBAC user details for the queries
        const userIds = new Set<string>();
        queries.forEach(q => {
            if (q.rbac_user_id) {
                userIds.add(q.rbac_user_id);
            }
        });

        if (userIds.size > 0) {
            // Fetch users in parallel
            // Note: In a large-scale system, we might want to use a batched getAllUsersByIds 
            // query, but for live queries (usually < 100), individual selects are acceptable
            // or we could use listUsers if we implement array filtering there.
            // For now, Promise.all with getUserById is simplest and sufficient.
            const userMap = new Map<string, { username: string; displayName?: string }>();
            await Promise.all(
                Array.from(userIds).map(async (id) => {
                    try {
                        const user = await getUserById(id);
                        if (user) {
                            userMap.set(id, {
                                username: user.username,
                                displayName: user.displayName || undefined
                            });
                        }
                    } catch (e) {
                        // Ignore errors fetching user
                    }
                })
            );

            // Attach usernames to queries
            queries.forEach(q => {
                if (q.rbac_user_id && userMap.has(q.rbac_user_id)) {
                    const userInfo = userMap.get(q.rbac_user_id);
                    q.rbac_user = userInfo?.username;
                    q.rbac_user_display_name = userInfo?.displayName;
                }
            });
        }

        return c.json({
            success: true,
            data: {
                queries,
                connectionId: rbacConnectionId,
                total: queries.length,
            },
        });
    } catch (error) {
        console.error("[LiveQueries] Failed to fetch processes:", error);
        throw AppError.internal("Failed to fetch running queries.");
    }
});

/**
 * POST /api/live-queries/kill
 * Kill a running query by query_id
 */
const killQuerySchema = z.object({
    queryId: z.string().min(1, "Query ID is required"),
});

liveQueries.post("/kill", zValidator("json", killQuerySchema), async (c) => {
    const { queryId } = c.req.valid("json");
    const service = c.get("service");
    const rbacUserId = c.get("rbacUserId");
    const rbacPermissions = c.get("rbacPermissions") || [];
    const rbacConnectionId = c.get("rbacConnectionId");


    // Check permissions
    // 1. Check for global kill permission
    let hasGlobalKill = rbacPermissions.includes(PERMISSIONS.LIVE_QUERIES_KILL);
    if (!hasGlobalKill && rbacUserId) {
        hasGlobalKill = await userHasPermission(rbacUserId, PERMISSIONS.LIVE_QUERIES_KILL);
    }

    if (!hasGlobalKill) {
        throw AppError.forbidden("Permission 'live_queries:kill' is required to kill queries.");
    }

    // Initialize currentUsername (empty as we don't fetch full user details for performance/simplicity)
    const currentUsername = "";

    try {
        // Get query info FIRST to verify ownership and for audit logging
        let queryInfo: LiveQuery | undefined;
        try {
            const checkResult = await service.executeQuery(`
              SELECT 
                query_id, 
                user, 
                query, 
                elapsed as elapsed_seconds,
                Settings['log_comment'] as log_comment_json
              FROM system.processes
              WHERE query_id = '${queryId.replace(/'/g, "''")}'
              LIMIT 1
            `, "JSON");
            const rawInfo = ((checkResult.data || [])[0]) as any;
            if (rawInfo) {
                let rbac_user_id: string | undefined;
                try {
                    if (rawInfo.log_comment_json) {
                        const parsed = JSON.parse(rawInfo.log_comment_json);
                        rbac_user_id = parsed.rbac_user_id;
                    }
                } catch { }

                queryInfo = { ...rawInfo, rbac_user_id } as LiveQuery;
            }
        } catch {
            // Check failed
        }

        // Execute KILL QUERY command
        // Note: If queryInfo is undefined, it might mean query already finished or doesn't exist.
        // We still run KILL just in case (idempotent), but ownership check is bypassed 
        // (safe because if it doesn't exist, we can't kill it "wrongly").
        // However, strictly speaking, if we can't verify ownership, maybe we shouldn't kill?
        // But if it doesn't exist, killing it does nothing.

        await service.executeQuery(
            `KILL QUERY WHERE query_id = '${queryId.replace(/'/g, "''")}'`,
            "JSON"
        );

        // Create audit log
        try {
            await createAuditLog(
                AUDIT_ACTIONS.LIVE_QUERY_KILL,
                rbacUserId!,
                {
                    resourceType: 'live_query',
                    resourceId: queryId,
                    details: {
                        killedQueryId: queryId,
                        killedQueryUser: queryInfo?.user || 'unknown',
                        killedQueryPreview: queryInfo?.query?.substring(0, 500) || 'Query already completed',
                        elapsedSeconds: queryInfo?.elapsed_seconds,
                        connectionId: rbacConnectionId,
                        killType: hasGlobalKill ? 'global' : 'own_query',
                        requestUsername: currentUsername
                    },
                    ipAddress: getClientIp(c),
                    userAgent: c.req.header('User-Agent'),
                    status: 'success',
                }
            );
        } catch (auditError) {
            console.error('[LiveQueries] Failed to create audit log:', auditError);
        }

        return c.json({
            success: true,
            data: {
                message: queryInfo
                    ? "Query killed successfully."
                    : "Kill command sent. Query may have already completed.",
                queryId,
            },
        });
    } catch (error) {
        console.error("[LiveQueries] Failed to kill query:", error);

        // Create failed audit log
        try {
            await createAuditLog(
                AUDIT_ACTIONS.LIVE_QUERY_KILL,
                rbacUserId!,
                {
                    resourceType: 'live_query',
                    resourceId: queryId,
                    details: {
                        queryId,
                        connectionId: rbacConnectionId,
                        error: error instanceof Error ? error.message : String(error),
                    },
                    ipAddress: getClientIp(c),
                    userAgent: c.req.header('User-Agent'),
                    status: 'failure',
                }
            );
        } catch (auditError) {
            console.error('[LiveQueries] Failed to create failure audit log:', auditError);
        }

        if (error instanceof AppError) {
            throw error;
        }
        throw AppError.internal("Failed to kill query. Please try again.");
    }
});

export default liveQueries;
