// Relation-level AST nodes.
//
// Relations form the tree the SQL serialiser walks. Each operator
// (`where`, `order`, `limit`, `offset`) wraps a source relation in an
// outer node, so the chain `users.where(...).limit(10)` is encoded as
// Limit -> Where -> TableRef. Out of scope: SQL serialisation (see
// src/sql/serialise.ts), runtime fluent wrappers (src/query/...).

import type { ExpressionNode } from "./expression.js";

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

/** A SELECT-list projection. */
export interface Project {
  readonly kind: "Project";
  readonly source: RelationNode;
  readonly items: readonly ProjectionItem[];
}

export interface ProjectionItem {
  readonly expression: ExpressionNode;
  readonly outputName: string;
}

/** A WHERE filter applied on top of a source relation. */
export interface Where {
  readonly kind: "Where";
  readonly source: RelationNode;
  readonly predicate: ExpressionNode;
}

/** An ORDER BY clause. Multiple terms emit in the order given. */
export interface Order {
  readonly kind: "Order";
  readonly source: RelationNode;
  readonly terms: readonly OrderTerm[];
}

export interface OrderTerm {
  readonly expression: ExpressionNode;
  readonly direction: "asc" | "desc";
}

/** A LIMIT clause. */
export interface Limit {
  readonly kind: "Limit";
  readonly source: RelationNode;
  readonly count: number;
}

/** An OFFSET clause. */
export interface Offset {
  readonly kind: "Offset";
  readonly source: RelationNode;
  readonly count: number;
}

/**
 * An INNER JOIN. The left side (`source`) is the existing relation —
 * it may already carry where/order/limit/offset/project. The right side
 * is restricted to a TableRef in v1.5; joining a sub-query is deferred.
 */
export interface InnerJoin {
  readonly kind: "InnerJoin";
  readonly source: RelationNode;
  readonly right: TableRef;
  readonly on: ExpressionNode;
}

export type RelationNode =
  | TableRef
  | Project
  | Where
  | Order
  | Limit
  | Offset
  | InnerJoin;

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

/** Build a Project node. Pure. */
export function project(
  source: RelationNode,
  items: readonly ProjectionItem[],
): Project {
  return { kind: "Project", source, items };
}

/** Build a ProjectionItem. Pure. */
export function projectionItem(
  expression: ExpressionNode,
  outputName: string,
): ProjectionItem {
  return { expression, outputName };
}

/** Build a Where node. Pure. */
export function where(source: RelationNode, predicate: ExpressionNode): Where {
  return { kind: "Where", source, predicate };
}

/** Build an Order node. Pure. */
export function order(
  source: RelationNode,
  terms: readonly OrderTerm[],
): Order {
  return { kind: "Order", source, terms };
}

/** Build a Limit node. Pure. */
export function limit(source: RelationNode, count: number): Limit {
  return { kind: "Limit", source, count };
}

/** Build an Offset node. Pure. */
export function offset(source: RelationNode, count: number): Offset {
  return { kind: "Offset", source, count };
}

/** Build an OrderTerm. Pure. */
export function orderTerm(
  expression: ExpressionNode,
  direction: "asc" | "desc",
): OrderTerm {
  return { expression, direction };
}

/** Build an InnerJoin node. Pure. */
export function innerJoin(
  source: RelationNode,
  right: TableRef,
  on: ExpressionNode,
): InnerJoin {
  return { kind: "InnerJoin", source, right, on };
}
