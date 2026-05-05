// Relation-level AST nodes.
//
// Relations form the tree the SQL serialiser walks. v1 only models a
// bare TableRef; further variants (Project, Where, Order, Limit,
// Offset, joins, set ops, ...) are added in later commits as the
// fluent layer grows. Out of scope: SQL serialisation (see
// src/sql/serialise.ts), runtime fluent wrappers (src/query/...).

/**
 * A reference to a base table. Always has an alias internally; the
 * alias defaults to the table name and is what column references are
 * qualified by. This makes joins drop in cleanly later: a join is just
 * a tree with two TableRefs that may carry distinct aliases.
 */
export interface TableRef {
  readonly kind: "TableRef";
  readonly schema: string;
  readonly name: string;
  readonly alias: string | null;
}

export type RelationNode = TableRef;

/** Build a TableRef node. Pure. */
export function tableRef(args: {
  readonly schema: string;
  readonly name: string;
  readonly alias?: string;
}): TableRef {
  return {
    kind: "TableRef",
    schema: args.schema,
    name: args.name,
    alias: args.alias ?? null,
  };
}
