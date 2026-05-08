// Fluent wrappers around relation AST trees: the base `Relation`
// class and the join-builder subclass `JoinBuilder`.
//
// `Relation` and `JoinBuilder` are co-located here because they form
// one fluent layer: every `JoinBuilder` is a `Relation` with one
// extra method, and `Relation.innerJoin` constructs `JoinBuilder`
// values. The viable alternatives all cost more than co-location:
//
//   - Putting them in separate files needs either an ESM circular
//     import (fails at the `extends Relation` evaluation when
//     JoinBuilder.ts loads before Relation finishes initialising)
//     or a module-init factory-registration hook (a runtime
//     invariant — `setJoinBuilderFactory` must run before any
//     `innerJoin` call — replacing a structural guarantee with an
//     invisible one).
//   - Replacing the class hierarchy with a `Relation<branded> & {
//     on }` type alias structurally type-checks but quietly drops
//     the FK-inference brand at `db.run(...)` time; the brand only
//     surfaces correctly when JoinBuilder is a class instantiation.
//   - Splitting `Relation` into a `BaseRelation` (no `innerJoin`)
//     plus a `Relation` overlay breaks chained joins
//     (`a.innerJoin(b).innerJoin(c)`), which need each step's
//     result to carry `innerJoin` itself.
//
// `JoinBuilder.ts` exists as a one-line re-export so external
// imports keep their natural path.
//
// Two phantom generics flow through every operator on Relation:
// Columns describes the row shape after the chain runs, and FKs is a
// tuple of foreign keys carried for join inference. The serialiser
// uses the FK list on each TableRef AST node to fill in an ON
// predicate when JoinBuilder was constructed without `.on(...)`.
//
// Out of scope: SQL serialisation; column accessor merging (handled
// by `defineTable`, which intersects the Table type with the
// per-column accessor map).

import { innerJoin as innerJoinNode } from "../ast/relation.js";
import {
  limit as limitNode,
  offset as offsetNode,
  order as orderNode,
  project as projectNode,
  where as whereNode,
} from "../ast/relation.js";
import type { RelationNode, TableRef } from "../ast/relation.js";
import type { ColumnsShape } from "../schema-runtime/columnType.js";
import type { Expression } from "./Expression.js";
import type { Ordering } from "./Ordering.js";
import { toProjectionItem } from "./projection.js";
import type {
  ForeignKeyTuple,
  MergedColumns,
  MergedColumnsWithFkBrand,
  MergedForeignKeys,
  ProjectableItem,
  ProjectedShape,
} from "./types.js";

export class Relation<
  Columns extends ColumnsShape,
  FKs extends ForeignKeyTuple = readonly [],
> {
  // Phantoms: track the column shape and FK list so future projections
  // and joins can narrow them. Never read at runtime on Relation
  // itself; on Table the `_foreignKeys` field is also a real runtime
  // value carrying the FK list emitted by `defineTable`.
  declare readonly _columns: Columns;
  declare readonly _foreignKeys: FKs;

  constructor(readonly node: RelationNode) {}

  /** Filter this relation by a boolean expression. */
  where(predicate: Expression<boolean>): Relation<Columns, FKs> {
    return new Relation<Columns, FKs>(whereNode(this.node, predicate.node));
  }

  /**
   * Sort this relation by one or more `column.asc()` / `column.desc()`
   * orderings. Calling `.order` again on the result replaces the
   * existing terms (outermost wins); use a single call with all terms
   * if you want a multi-column sort.
   */
  order(...orderings: readonly Ordering[]): Relation<Columns, FKs> {
    const terms = orderings.map((ordering) => ordering.node);
    return new Relation<Columns, FKs>(orderNode(this.node, terms));
  }

  /** Cap this relation at `count` rows. */
  limit(count: number): Relation<Columns, FKs> {
    return new Relation<Columns, FKs>(limitNode(this.node, count));
  }

  /** Skip `count` rows before returning results. */
  offset(count: number): Relation<Columns, FKs> {
    return new Relation<Columns, FKs>(offsetNode(this.node, count));
  }

  /**
   * Restrict (and optionally rename) the columns this relation
   * exposes. The resulting Relation's columns shape is inferred from
   * the literal types of the items so callers see a precise row
   * shape after `db.run(...)`. FKs are preserved unchanged because
   * they describe the source tables, not the projected row shape.
   */
  project<const Items extends readonly ProjectableItem[]>(
    ...items: Items
  ): Relation<ProjectedShape<Items>, FKs> {
    const projectionItems = items.map(toProjectionItem);
    return new Relation<ProjectedShape<Items>, FKs>(
      projectNode(this.node, projectionItems),
    );
  }

  /**
   * Inner-join this relation with another defined table. Returns a
   * JoinBuilder that *is* a runnable Relation: when `.on(...)` is
   * omitted the serialiser fills in the ON predicate from FK
   * metadata on the two sides. Calling `.on(predicate)` returns a
   * fresh Relation with the explicit predicate baked in.
   *
   * The right side is restricted to a `defineTable(...)` value (it
   * must carry `_tableName` / `_schema`) so the join's right side is
   * a base table reference, not an arbitrary sub-query.
   */
  innerJoin<
    RColumns extends ColumnsShape,
    RFKs extends ForeignKeyTuple = readonly [],
  >(
    right: Relation<RColumns, RFKs> & {
      readonly _tableName: string;
      readonly _schema: string;
    },
  ): JoinBuilder<Columns, FKs, string, string, RColumns, RFKs, string, string> {
    if (right.node.kind !== "TableRef") {
      throw new Error(
        "innerJoin's right side must be a defined table (got a derived relation).",
      );
    }
    return new JoinBuilder(this.node, right.node);
  }
}

/**
 * Two-step builder for an inner join. JoinBuilder extends Relation,
 * so the join is *runnable directly* — when `.on(...)` is omitted the
 * serialiser fills in the ON predicate from FK metadata. Calling
 * `.on(predicate)` returns a fresh Relation with the explicit
 * predicate; the JoinBuilder itself stays valid as the no-`on` form.
 *
 * The four generics carry the two sides' column shapes and FK
 * tuples so the resulting Relation knows its merged columns shape
 * and its merged FK list. Commit 7 will graft a literal-template
 * brand onto the merged-columns shape when the FK lookup is
 * ambiguous, missing, or self-referential, so the type system
 * catches the cases the serialiser would otherwise throw on.
 */
export class JoinBuilder<
  Left extends ColumnsShape,
  LFKs extends ForeignKeyTuple,
  LSchema extends string,
  LPhysicalName extends string,
  Right extends ColumnsShape,
  RFKs extends ForeignKeyTuple,
  RSchema extends string,
  RPhysicalName extends string,
> extends Relation<
  MergedColumnsWithFkBrand<
    Left,
    Right,
    LFKs,
    LSchema,
    LPhysicalName,
    RFKs,
    RSchema,
    RPhysicalName
  >,
  MergedForeignKeys<LFKs, RFKs>
> {
  // Phantoms: never read at runtime; carry the two sides' shapes and
  // identities so the merged-columns shape can compute the
  // FK-inference brands (self-join here, missing/ambiguous in 7b).
  declare readonly _left: Left;
  declare readonly _leftFks: LFKs;
  declare readonly _leftSchema: LSchema;
  declare readonly _leftPhysicalName: LPhysicalName;
  declare readonly _right: Right;
  declare readonly _rightFks: RFKs;
  declare readonly _rightSchema: RSchema;
  declare readonly _rightPhysicalName: RPhysicalName;

  constructor(
    private readonly leftSource: RelationNode,
    private readonly rightTable: TableRef,
  ) {
    super(innerJoinNode(leftSource, rightTable, null));
  }

  /**
   * Complete the inner join with an explicit boolean predicate.
   * Predicates may freely reference columns from either side. The
   * returned Relation has the plain merged-columns shape (no
   * inference brand) because an explicit predicate clears every
   * inference-error case.
   */
  on(
    predicate: Expression<boolean>,
  ): Relation<MergedColumns<Left, Right>, MergedForeignKeys<LFKs, RFKs>> {
    return new Relation<
      MergedColumns<Left, Right>,
      MergedForeignKeys<LFKs, RFKs>
    >(innerJoinNode(this.leftSource, this.rightTable, predicate.node));
  }
}
