/**
 * CREATE TABLE text for the Explorer's Create Table dialog (submit and preview).
 *
 * Names (database, table, columns, ORDER BY columns, cluster) are quoted as
 * identifiers and comments as string literals. Column types must be a plain
 * type signature. DEFAULT, PARTITION BY and TTL are SQL expressions the user
 * writes on purpose, so they are passed through as typed; the statement then
 * runs through the server's query access checks like any other SQL.
 */
import { quoteIdentifier, quoteStringLiteral, validateColumnType } from "./sqlUtils";

export interface CreateTableColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  description?: string;
}

export interface CreateTableSqlInput {
  database: string;
  table: string;
  columns: CreateTableColumn[];
  engine: string;
  orderBy?: string[];
  partitionBy?: string;
  ttl?: string;
  comment?: string;
  cluster?: string;
}

export class CreateTableSqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreateTableSqlError";
  }
}

/** Build the statement. Throws CreateTableSqlError for an invalid column type or engine. */
export function buildCreateTableSql(input: CreateTableSqlInput): string {
  const columnDefs = input.columns.map((col) => {
    const type = col.type.trim();
    if (!validateColumnType(type)) {
      throw new CreateTableSqlError(`Invalid column type "${col.type}" for column "${col.name}"`);
    }
    let def = `${quoteIdentifier(col.name)} ${col.nullable ? `Nullable(${type})` : type}`;
    if (col.defaultValue?.trim()) def += ` DEFAULT ${col.defaultValue.trim()}`;
    if (col.description) def += ` COMMENT ${quoteStringLiteral(col.description)}`;
    return def;
  });

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.engine)) {
    throw new CreateTableSqlError(`Invalid engine "${input.engine}"`);
  }

  let query = `CREATE TABLE ${quoteIdentifier(input.database)}.${quoteIdentifier(input.table)}`;
  if (input.cluster) query += ` ON CLUSTER ${quoteIdentifier(input.cluster)}`;
  query += ` (\n    ${columnDefs.join(",\n    ")}\n)`;
  query += `\nENGINE = ${input.engine}`;
  if (input.orderBy && input.orderBy.length > 0) {
    query += `\nORDER BY (${input.orderBy.map(quoteIdentifier).join(", ")})`;
  }
  if (input.partitionBy?.trim()) query += `\nPARTITION BY ${input.partitionBy.trim()}`;
  if (input.ttl?.trim()) query += `\nTTL ${input.ttl.trim()}`;
  if (input.comment) query += `\nCOMMENT ${quoteStringLiteral(input.comment)}`;
  return query;
}
