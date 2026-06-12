/**
 * SSO Identity Store
 *
 * CRUD for rbac_user_identities — links between local users and IdP subjects.
 */

import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDatabase, getSchema } from "../db";

// Same dual-DB escape hatch used by services/rbac.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export interface UserIdentity {
  id: string;
  userId: string;
  provider: string;
  subject: string;
  email: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export async function getUserIdentity(
  provider: string,
  subject: string
): Promise<UserIdentity | null> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const rows = await db
    .select()
    .from(schema.userIdentities)
    .where(
      and(
        eq(schema.userIdentities.provider, provider),
        eq(schema.userIdentities.subject, subject)
      )
    )
    .limit(1);
  return (rows[0] as UserIdentity) || null;
}

export async function createUserIdentity(input: {
  userId: string;
  provider: string;
  subject: string;
  email?: string | null;
}): Promise<UserIdentity> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const row: UserIdentity = {
    id: randomUUID(),
    userId: input.userId,
    provider: input.provider,
    subject: input.subject,
    email: input.email ?? null,
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
  await db.insert(schema.userIdentities).values(row);
  return row;
}

export async function touchUserIdentity(id: string): Promise<void> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  await db
    .update(schema.userIdentities)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.userIdentities.id, id));
}

export async function userHasSsoIdentity(userId: string): Promise<boolean> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const rows = await db
    .select({ id: schema.userIdentities.id })
    .from(schema.userIdentities)
    .where(eq(schema.userIdentities.userId, userId))
    .limit(1);
  return rows.length > 0;
}

export async function listUserIdentities(
  userId: string
): Promise<UserIdentity[]> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  const rows = await db
    .select()
    .from(schema.userIdentities)
    .where(eq(schema.userIdentities.userId, userId));
  return rows as UserIdentity[];
}

export async function deleteUserIdentity(id: string): Promise<void> {
  const db = getDatabase() as AnyDb;
  const schema = getSchema();
  await db
    .delete(schema.userIdentities)
    .where(eq(schema.userIdentities.id, id));
}
