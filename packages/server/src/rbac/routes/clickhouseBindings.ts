/**
 * Bindings between accounts and ClickHouse users (ADR 0033 §7.4).
 *
 *   GET    /clickhouse-bindings/mine                         a person's own links and their state
 *   POST   /clickhouse-bindings/:id/recheck                  "check again": the owner, or a super admin
 *   GET    /clickhouse-bindings/connection/:connectionId     super admin: links, the grant script, unbound users
 *   POST   /clickhouse-bindings/connection/:connectionId     super admin: link an account to a ClickHouse user
 *   POST   /clickhouse-bindings/:id/confirm                  super admin: confirm a suspended link again
 *   DELETE /clickhouse-bindings/:id                          super admin: remove a link
 *
 * Creating, confirming and removing are a super admin's alone: a binding
 * gives an account the grants of a ClickHouse user, so an admin could
 * otherwise link themselves to a user who holds more than they should reach.
 * No route here takes or returns a ClickHouse password.
 */

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

import { all, num, sql } from '../../services/observe/db';
import { AppError, requireParam } from '../../types';
import { getRbacUser, rbacAuthMiddleware, refuseScopedToken } from '../middleware';
import {
  bindingCounts,
  confirmBinding,
  createBinding,
  getBinding,
  grantScript,
  listBindingsOfConnection,
  listBindingsOfUser,
  recheckBinding,
  removeBinding,
  type BindingView,
} from '../services/clickhouseBindings';
import { getConnectionById } from '../services/connections';

const clickhouseBindingsRoutes = new Hono();

const createSchema = z.object({
  userId: z.string().min(1).max(255),
  clickhouseUser: z.string().min(1).max(128),
});

function requireSuperAdmin(c: Context): string {
  // The role is all that gates these routes, and a token keeps its owner's roles whatever its scope.
  refuseScopedToken(c);
  const user = getRbacUser(c);
  if (!user.roles.includes('super_admin')) {
    throw AppError.forbidden('Only a super admin can link an account to a ClickHouse user.');
  }
  return user.sub;
}

/** What a person sees of their own link: no ids of other things, no account fields. */
function own(binding: BindingView): Record<string, unknown> {
  return {
    id: binding.id,
    connectionId: binding.connectionId,
    connectionName: binding.connectionName,
    connectionKind: binding.connectionKind,
    clickhouseUser: binding.clickhouseUser,
    defaultDatabase: binding.defaultDatabase,
    state: binding.state,
    reason: binding.reason,
    checkedAt: binding.checkedAt,
  };
}

clickhouseBindingsRoutes.get('/mine', rbacAuthMiddleware, async (c) => {
  const user = getRbacUser(c);
  return c.json({ success: true, data: { bindings: (await listBindingsOfUser(user.sub)).map(own) } });
});

clickhouseBindingsRoutes.get('/connection/:connectionId', rbacAuthMiddleware, async (c) => {
  requireSuperAdmin(c);
  const connectionId = requireParam(c, 'connectionId');
  const connection = await getConnectionById(connectionId);
  if (!connection) throw AppError.notFound('Connection not found');
  const [bindings, script, counts, jobs] = await Promise.all([
    listBindingsOfConnection(connectionId),
    grantScript(connectionId),
    bindingCounts(connectionId),
    // Scheduled work whose owner could not run it on a personal connection today.
    all(sql`
      SELECT COUNT(*) AS n FROM scheduled_queries q
      WHERE q.connection_id = ${connectionId}
        AND NOT EXISTS (SELECT 1 FROM rbac_clickhouse_bindings b WHERE b.connection_id = q.connection_id AND b.user_id = q.owner_id AND b.state = 'active')`).catch(() => []),
  ]);
  return c.json({
    success: true,
    data: {
      bindings,
      grants: script.grants,
      unbound: script.unbound,
      readiness: { counts, jobsWithoutLink: jobs.length > 0 ? num(jobs[0].n) : 0 },
    },
  });
});

clickhouseBindingsRoutes.post('/connection/:connectionId', rbacAuthMiddleware, zValidator('json', createSchema), async (c) => {
  const actor = requireSuperAdmin(c);
  const body = c.req.valid('json');
  const binding = await createBinding(requireParam(c, 'connectionId'), body.userId, body.clickhouseUser, actor);
  return c.json({ success: true, data: { binding } }, 201);
});

clickhouseBindingsRoutes.post('/:id/confirm', rbacAuthMiddleware, async (c) => {
  const actor = requireSuperAdmin(c);
  return c.json({ success: true, data: { binding: await confirmBinding(requireParam(c, 'id'), actor) } });
});

clickhouseBindingsRoutes.post('/:id/recheck', rbacAuthMiddleware, async (c) => {
  const user = getRbacUser(c);
  const binding = await getBinding(requireParam(c, 'id'));
  // A token that names a scope is not held to it by a role, so it acts here as the account's owner only.
  const superAdmin = user.roles.includes('super_admin') && c.get('tokenScoped') !== true;
  // The same answer for a link that is not there and one that is someone else's.
  if (!binding || (binding.userId !== user.sub && !superAdmin)) throw AppError.notFound('Link not found');
  const checked = await recheckBinding(binding.id, user.sub);
  return c.json({ success: true, data: { binding: superAdmin ? checked : own(checked) } });
});

clickhouseBindingsRoutes.delete('/:id', rbacAuthMiddleware, async (c) => {
  const actor = requireSuperAdmin(c);
  await removeBinding(requireParam(c, 'id'), actor);
  return c.json({ success: true });
});

export default clickhouseBindingsRoutes;
