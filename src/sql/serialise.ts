// AST -> SQL serialiser.
//
// Pure: takes a RelationNode tree, returns { text, params }. The text
// is parameterised SQL using $1, $2, ... placeholders compatible with
// node-postgres. The params array is in the order the placeholders
// appear in the text.
//
// Strategy: walk the relation tree once to collect clauses (FROM,
// WHEREs, ORDER BY terms, LIMIT, OFFSET), then emit them in canonical
// SQL order. Expressions are emitted recursively, threading
// parameters through a single EmitContext so placeholder numbering is
// always left-to-right and tree transforms never need to renumber.
//
// Out of scope: query execution (src/executor/...); AST construction
// (src/ast/...); fluent wrappers (src/query/...).

import type { ExpressionNode } from "../ast/expression.js";
import type { OrderTerm, RelationNode, TableRef } from "../ast/relation.js";
import { quoteIdent } from "./identifier.js";
import { binarySql, unaryPrefixSql, unarySuffixSql } from "./operators.js";

/** A serialised SQL statement plus its bound parameters. */
export interface CompiledQuery {
  readonly text: string;
  readonly params: readonly unknown[];
}

/** Serialise a relation tree to a parameterised SQL SELECT. */
export function relationToSql(node: RelationNode): CompiledQuery {
  const ctx: EmitContext = { params: [] };
  const text = emitSelect(node, ctx);
  return { text, params: ctx.params };
}

/**
 * Mutable accumulator for parameter values during a single
 * serialisation. The mutation is contained to one top-level call;
 * relationToSql is externally pure.
 */
interface EmitContext {
  readonly params: unknown[];
}

interface CollectedClauses {
  table: TableRef | null;
  predicates: ExpressionNode[];
  orderTerms: readonly OrderTerm[] | null;
  limit: number | null;
  offset: number | null;
}

/** Walk the relation tree and gather clauses for canonical-order emit. */
function collect(node: RelationNode, clauses: CollectedClauses): void {
  switch (node.kind) {
    case "TableRef":
      clauses.table = node;
      return;
    case "Where":
      // Predicates are unshifted so source-tree order matches the
      // user's chaining order: r.where(a).where(b) emits `a AND b`.
      clauses.predicates.unshift(node.predicate);
      collect(node.source, clauses);
      return;
    case "Order":
      // Outer wins: only set if not already set by an outer Order.
      if (clauses.orderTerms === null) clauses.orderTerms = node.terms;
      collect(node.source, clauses);
      return;
    case "Limit":
      if (clauses.limit === null) clauses.limit = node.count;
      collect(node.source, clauses);
      return;
    case "Offset":
      if (clauses.offset === null) clauses.offset = node.count;
      collect(node.source, clauses);
      return;
  }
}

/** Build the canonical SELECT string from a relation tree. */
function emitSelect(node: RelationNode, ctx: EmitContext): string {
  const clauses: CollectedClauses = {
    table: null,
    predicates: [],
    orderTerms: null,
    limit: null,
    offset: null,
  };
  collect(node, clauses);
  if (clauses.table === null) {
    throw new Error("Relation tree has no source table.");
  }

  const parts: string[] = [`SELECT * FROM ${emitTableRef(clauses.table)}`];
  if (clauses.predicates.length > 0) {
    parts.push(`WHERE ${emitPredicates(clauses.predicates, ctx)}`);
  }
  if (clauses.orderTerms !== null && clauses.orderTerms.length > 0) {
    parts.push(`ORDER BY ${emitOrderTerms(clauses.orderTerms, ctx)}`);
  }
  if (clauses.limit !== null) {
    parts.push(`LIMIT ${clauses.limit}`);
  }
  if (clauses.offset !== null) {
    parts.push(`OFFSET ${clauses.offset}`);
  }
  return parts.join(" ");
}

/** Emit a TableRef as `"schema"."name"` plus an optional `AS "alias"`. */
function emitTableRef(node: TableRef): string {
  const qualified = `${quoteIdent(node.schema)}.${quoteIdent(node.name)}`;
  if (node.alias === null || node.alias === node.name) {
    return qualified;
  }
  return `${qualified} AS ${quoteIdent(node.alias)}`;
}

/** Emit a list of predicates joined by AND (parenthesised individually). */
function emitPredicates(
  predicates: readonly ExpressionNode[],
  ctx: EmitContext,
): string {
  return predicates
    .map((predicate) => emitExpression(predicate, ctx))
    .join(" AND ");
}

/** Emit an ORDER BY list as comma-separated `<expr> ASC|DESC` terms. */
function emitOrderTerms(terms: readonly OrderTerm[], ctx: EmitContext): string {
  return terms
    .map(
      (term) =>
        `${emitExpression(term.expression, ctx)} ${term.direction.toUpperCase()}`,
    )
    .join(", ");
}

/** Recursively emit an expression node, appending any parameters. */
function emitExpression(node: ExpressionNode, ctx: EmitContext): string {
  switch (node.kind) {
    case "ColumnRef":
      return `${quoteIdent(node.tableAlias)}.${quoteIdent(node.column)}`;
    case "Parameter":
      ctx.params.push(node.value);
      return `$${ctx.params.length}`;
    case "BinaryOp": {
      const left = emitExpression(node.left, ctx);
      const right = emitExpression(node.right, ctx);
      return `(${left} ${binarySql(node.operator)} ${right})`;
    }
    case "UnaryOp": {
      const operand = emitExpression(node.operand, ctx);
      return `(${unaryPrefixSql(node.operator)}${operand}${unarySuffixSql(
        node.operator,
      )})`;
    }
    case "InList": {
      const operand = emitExpression(node.operand, ctx);
      const values = node.values
        .map((value) => emitExpression(value, ctx))
        .join(", ");
      return `(${operand} IN (${values}))`;
    }
  }
}
