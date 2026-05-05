// AST -> SQL serialiser.
//
// Pure: takes a RelationNode tree, returns { text, params }. The text
// is parameterised SQL using $1, $2, ... placeholders compatible with
// node-postgres. The params array is in the order the placeholders
// appear in the text.
//
// Out of scope: query execution (see src/executor/Database.ts), AST
// construction (see src/ast/...), fluent wrappers (src/query/...).

import type { RelationNode, TableRef } from "../ast/relation.js";
import { quoteIdent } from "./identifier.js";

/** A serialised SQL statement plus its bound parameters. */
export interface CompiledQuery {
  readonly text: string;
  readonly params: readonly unknown[];
}

/** Serialise a relation tree to a parameterised SQL SELECT. */
export function relationToSql(node: RelationNode): CompiledQuery {
  return { text: emitSelect(node), params: [] };
}

/** Emit a top-level SELECT for the given relation. */
function emitSelect(node: RelationNode): string {
  switch (node.kind) {
    case "TableRef":
      return `SELECT * FROM ${emitTableRef(node)}`;
  }
}

/** Emit a TableRef as `"schema"."name"` plus an optional `AS "alias"`. */
function emitTableRef(node: TableRef): string {
  const qualified = `${quoteIdent(node.schema)}.${quoteIdent(node.name)}`;
  if (node.alias === null || node.alias === node.name) {
    return qualified;
  }
  return `${qualified} AS ${quoteIdent(node.alias)}`;
}
