/**
 * A checked statement (ADR 0033 §2): typed text that passed the access check,
 * with exactly what was checked. Only the access check can make one, and the
 * executor sends typed text only in this form, so a route cannot check one
 * text and send another, or send typed text that was never checked.
 */

/**
 * How a checked statement is sent on a `personal` connection (ADR 0033 §7.2):
 * the texts ClickHouse parsed with the wrapper around them, and the user they
 * were parsed for.
 */
export interface ImpersonatedText {
  /** The bound ClickHouse user the wrapper names. */
  user: string;
  /** `EXECUTE AS <user> <typed text>`. */
  sql: string;
  /**
   * The text to send when the statement must be a read: with `readonly = 1`
   * in its own SETTINGS clause where the kind can carry one, the plain text
   * for a kind that cannot write, and null when it cannot be sent as a read.
   */
  readOnlySql: string | null;
}

export interface CheckedFields {
  /** The exact text that was checked and will run. */
  sql: string;
  /** The query parameters it was checked with. */
  params: Record<string, unknown> | undefined;
  /** The connection it was checked for; undefined only in tests that pass their own parser. */
  connectionId: string | undefined;
  /** The account it was checked for. */
  accountId: string;
  /** True when ClickHouse's own parse says the statement only reads. */
  isRead: boolean;
  /** True when the account holds a permission that lets it change anything through typed text. */
  mayWrite: boolean;
  /** Set exactly when the statement was checked for a `personal` connection. */
  impersonated?: ImpersonatedText;
}

let make: (fields: CheckedFields) => CheckedStatement;

export class CheckedStatement implements CheckedFields {
  /** A private member, so an object literal with the same fields is not a CheckedStatement to the compiler. */
  readonly #made = true;
  readonly sql: string;
  readonly params: Record<string, unknown> | undefined;
  readonly connectionId: string | undefined;
  readonly accountId: string;
  readonly isRead: boolean;
  readonly mayWrite: boolean;
  readonly impersonated: Readonly<ImpersonatedText> | undefined;

  private constructor(fields: CheckedFields) {
    this.sql = fields.sql;
    this.params = fields.params;
    this.connectionId = fields.connectionId;
    this.accountId = fields.accountId;
    this.isRead = fields.isRead;
    this.mayWrite = fields.mayWrite;
    this.impersonated = fields.impersonated ? Object.freeze({ ...fields.impersonated }) : undefined;
    Object.freeze(this);
  }

  static {
    make = (fields) => new CheckedStatement(fields);
  }

  /** True only for a statement the access check made; a look-alike object fails. */
  static isReal(value: unknown): value is CheckedStatement {
    return value instanceof CheckedStatement && #made in value && value.#made;
  }
}

/**
 * Make a checked statement. Only `middleware/dataAccess.ts` may import this:
 * `bun run check:clickhouse-access` fails on any other importer.
 */
export function mintCheckedStatement(fields: CheckedFields): CheckedStatement {
  return make(fields);
}
