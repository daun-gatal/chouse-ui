import { defineConfig } from 'drizzle-kit';

const dbType = process.env.RBAC_DB_TYPE || 'sqlite';

export default defineConfig({
  dialect: dbType === 'postgres' ? 'postgresql' : 'sqlite',
  schema: dbType === 'postgres' 
    ? './src/rbac/schema/postgres.ts' 
    : './src/rbac/schema/sqlite.ts',
  out: dbType === 'postgres'
    ? './src/rbac/migrations/postgres'
    : './src/rbac/migrations/sqlite',
  dbCredentials: dbType === 'postgres'
    ? { url: process.env.RBAC_POSTGRES_URL || process.env.DATABASE_URL || '' }
    : { url: process.env.RBAC_SQLITE_PATH || './data/rbac.db' },
});
