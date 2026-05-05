// SQL identifier quoting.
//
// Always-quote, always-escape. Postgres treats a quoted, lowercase
// identifier as equivalent to the unquoted form, so unconditionally
// quoting is safe and side-steps the entire class of "is this a reserved
// word" or "does this need quoting" bugs. Embedded double quotes inside
// an identifier are escaped by doubling, per the SQL standard.

/** Quote a single SQL identifier (table name, column name, alias). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, `""`)}"`;
}
