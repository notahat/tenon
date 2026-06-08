// Type-level tests. Each `@ts-expect-error` line documents a compile
// error we rely on; if the surrounding code starts compiling, the
// directive flags the regression. `expectTypeOf` checks positive
// type-flow expectations.

import { expectTypeOf, test } from "vitest";

import { Expression } from "../../src/query/Expression.js";
import type { Relation } from "../../src/query/Relation.js";
import type { RowOf } from "../../src/query/types.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";

const users = defineTable("public", "users", {
  id: columnType<number, "int4">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
  email: columnType<string, "text">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
  age: columnType<number, "int4">({
    nullable: true,
    hasDefault: false,
    isGenerated: false,
  }),
});

test("comparators accept matching literal types", () => {
  expectTypeOf(users.id.eq(42)).toEqualTypeOf<Expression<boolean>>();
  expectTypeOf(users.email.eq("a@b")).toEqualTypeOf<Expression<boolean>>();
});

test("comparators reject mismatched literal types", () => {
  // @ts-expect-error number column does not accept a string literal
  users.id.eq("not a number");

  // @ts-expect-error text column does not accept a number literal
  users.email.eq(0);
});

test("eq does not accept null even on nullable columns", () => {
  // @ts-expect-error use isNull() instead of eq(null)
  users.age.eq(null);

  // @ts-expect-error non-nullable column also rejects null
  users.id.eq(null);
});

test("comparators accept another column of the matching type", () => {
  expectTypeOf(users.id.eq(users.age)).toEqualTypeOf<Expression<boolean>>();
});

test("comparators reject another column of a different TS type", () => {
  // @ts-expect-error number column cannot be compared to text column
  users.id.eq(users.email);
});

test("isNull / isNotNull return boolean expressions", () => {
  expectTypeOf(users.age.isNull()).toEqualTypeOf<Expression<boolean>>();
  expectTypeOf(users.age.isNotNull()).toEqualTypeOf<Expression<boolean>>();
});

test("and / or / not chain only on boolean expressions", () => {
  const a = users.id.eq(1);
  const b = users.email.eq("a");
  expectTypeOf(a.and(b)).toEqualTypeOf<Expression<boolean>>();
  expectTypeOf(a.or(b)).toEqualTypeOf<Expression<boolean>>();
  expectTypeOf(a.not()).toEqualTypeOf<Expression<boolean>>();
});

test("relation.where requires an Expression<boolean>", () => {
  // @ts-expect-error a bare Column is not an Expression
  users.where(users.id);

  // @ts-expect-error a string is not an Expression<boolean>
  users.where("id = 1");
});

test("relation.order requires Ordering objects, not bare columns", () => {
  // @ts-expect-error use users.id.asc() rather than passing the column
  users.order(users.id);
});

test("chaining preserves the column accessors on the source table", () => {
  const filtered = users.where(users.id.eq(1));
  // @ts-expect-error post-where Relation has no merged column accessors
  void filtered.id;
  // But the original table still does:
  expectTypeOf(users.id.eq(1)).toEqualTypeOf<Expression<boolean>>();
});

test("project of a single column produces a row with that column only", () => {
  const projected = users.project(users.id);
  expectTypeOf<RowOf<(typeof projected)["_columns"]>>().toEqualTypeOf<{
    id: number;
  }>();
});

test("project of multiple columns produces a row with all of them", () => {
  const projected = users.project(users.id, users.email);
  expectTypeOf<RowOf<(typeof projected)["_columns"]>>().toEqualTypeOf<{
    id: number;
    email: string;
  }>();
});

test("project with `as` alias renames the row key", () => {
  const projected = users.project(users.id.as("userId"), users.email);
  expectTypeOf<RowOf<(typeof projected)["_columns"]>>().toEqualTypeOf<{
    userId: number;
    email: string;
  }>();
});

test("nullable columns widen the row type by | null", () => {
  const projected = users.project(users.id, users.age);
  expectTypeOf<RowOf<(typeof projected)["_columns"]>>().toEqualTypeOf<{
    id: number;
    age: number | null;
  }>();
});

test("project returns a Relation that supports further operators", () => {
  const projected = users.project(users.id);
  expectTypeOf(projected).toExtend<Relation<{ id: typeof users.id._type }>>();
  expectTypeOf(projected.limit(1)).toExtend<typeof projected>();
});
