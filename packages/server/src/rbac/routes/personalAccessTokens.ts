/**
 * Personal Access Token Routes
 *
 * Self-service machine-credential management. All endpoints are owner-scoped
 * and require a browser JWT session — PATs can never manage tokens (see the
 * privilege fence in ADR 0011).
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  createPat,
  listPats,
  revokePat,
  rotatePat,
} from "../services/personalAccessTokens";
import {
  createAuditLogWithContext,
  getUserById,
} from "../services/rbac";
import { AUDIT_ACTIONS } from "../schema/base";
import {
  rbacAuthMiddleware,
  getClientIp,
  getRbacUser,
  requireJwtSession,
} from "../middleware/rbacAuth";
import { requestLogger } from "../../utils/logger";
import { AppError } from "../../types";

const patRoutes = new Hono();

// JWT session auth for every endpoint (PATs are fenced out per-route below).
patRoutes.use("*", rbacAuthMiddleware);

const CreatePatSchema = z.object({
  name: z.string().min(1, "Token name is required").max(64, "Token name must be at most 64 characters"),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  scopes: z.array(z.string().min(1)).max(200).optional(),
});

/**
 * GET /rbac/pats
 * List the authenticated user's tokens (metadata only).
 */
patRoutes.get("/", async (c) => {
  requireJwtSession(c);
  const user = getRbacUser(c);

  const tokens = await listPats(user.sub);
  return c.json({ success: true, data: { tokens } });
});

/**
 * POST /rbac/pats
 * Create a token. The raw secret is returned exactly once.
 */
patRoutes.post("/", zValidator("json", CreatePatSchema), async (c) => {
  requireJwtSession(c);
  const user = getRbacUser(c);
  const { name, expiresAt, scopes } = c.req.valid("json");
  const ipAddress = getClientIp(c);

  const fullUser = await getUserById(user.sub);
  if (!fullUser) {
    throw AppError.notFound("User not found");
  }

  const created = await createPat(user.sub, {
    name,
    expiresAt: expiresAt ?? null,
    scopes,
  });

  await createAuditLogWithContext(c, AUDIT_ACTIONS.PAT_CREATE, user.sub, {
    resourceType: "personal_access_token",
    resourceId: created.id,
    details: {
      name: created.name,
      keyPrefix: created.keyPrefix,
      scopes: created.scopes,
      expiresAt: created.expiresAt?.toISOString() ?? null,
    },
    ipAddress,
    status: "success",
  }).catch((error: unknown) => {
    requestLogger(c.get("requestId")).warn(
      { module: "PAT", err: error instanceof Error ? error.message : String(error) },
      "Failed to audit token creation"
    );
  });

  const { rawToken, ...meta } = created;
  return c.json(
    {
      success: true,
      data: {
        token: meta,
        // Shown once — the UI must display it now; it is never retrievable.
        rawToken,
      },
    },
    201
  );
});

/**
 * DELETE /rbac/pats/:id
 * Revoke one of the authenticated user's tokens (idempotent). Revoked tokens
 * are hidden from the list; the audit log keeps the trail.
 */
patRoutes.delete("/:id", async (c) => {
  requireJwtSession(c);
  const user = getRbacUser(c);
  const id = c.req.param("id");
  const ipAddress = getClientIp(c);

  const revoked = await revokePat(user.sub, id);
  if (!revoked) {
    throw AppError.notFound("Token not found");
  }

  await createAuditLogWithContext(c, AUDIT_ACTIONS.PAT_REVOKE, user.sub, {
    resourceType: "personal_access_token",
    resourceId: revoked.id,
    details: { name: revoked.name, keyPrefix: revoked.keyPrefix },
    ipAddress,
    status: "success",
  }).catch((error: unknown) => {
    requestLogger(c.get("requestId")).warn(
      { module: "PAT", err: error instanceof Error ? error.message : String(error) },
      "Failed to audit token revocation"
    );
  });

  return c.json({ success: true, data: { token: revoked } });
});

/**
 * POST /rbac/pats/:id/rotate
 * Invalidate the secret and mint a replacement with identical name, scopes,
 * and expiry. The new raw secret is returned exactly once.
 */
patRoutes.post("/:id/rotate", async (c) => {
  requireJwtSession(c);
  const user = getRbacUser(c);
  const id = c.req.param("id");
  const ipAddress = getClientIp(c);

  const fullUser = await getUserById(user.sub);
  if (!fullUser) {
    throw AppError.notFound("User not found");
  }

  const rotated = await rotatePat(user.sub, id);
  if (!rotated) {
    throw AppError.notFound("Token not found");
  }

  await createAuditLogWithContext(c, AUDIT_ACTIONS.PAT_ROTATE, user.sub, {
    resourceType: "personal_access_token",
    resourceId: rotated.id,
    details: {
      name: rotated.name,
      keyPrefix: rotated.keyPrefix,
      rotatedFrom: id,
    },
    ipAddress,
    status: "success",
  }).catch((error: unknown) => {
    requestLogger(c.get("requestId")).warn(
      { module: "PAT", err: error instanceof Error ? error.message : String(error) },
      "Failed to audit token rotation"
    );
  });

  const { rawToken, ...meta } = rotated;
  return c.json(
    {
      success: true,
      data: {
        token: meta,
        // Shown once — the UI must display it now; it is never retrievable.
        rawToken,
      },
    },
    201
  );
});

export default patRoutes;
