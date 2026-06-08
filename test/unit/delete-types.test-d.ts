// Type-level tests for Table.delete / Table.deleteAll /
// WritableScope.delete / Delete.returning / Database.run dispatch.
// `@ts-expect-error` lines document compile errors we rely on; if the
// surrounding code starts compiling, the directive flags the
// regression.

import { expectTypeOf, test } from "vitest";

import type { Database } from "../../src/executor/Database.js";
import { Delete } from "../../src/query/Delete.js";
import { WritableScope } from "../../src/query/WritableScope.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";

declare const database: Database;

const users = defineTable("public", "users", {
  id: columnType<number, "int4">({
    nullable: false,
    hasDefault: true,
    isGenerated: false,
  }),
  email: columnType<string, "text">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
  active: columnType<boolean, "bool">({
    nullable: false,
    hasDefault: true,
    isGenerated: false,
  }),
});

const posts = defineTable("public", "posts", {
  id: columnType<number, "int4">({
    nullable: false,
    hasDefault: true,
    isGenerated: false,
  }),
  authorId: columnType<number, "int4">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
});

type UsersColumns = (typeof users)["_columns"];

test("Table.where returns a WritableScope", () => {
  const scope = users.where(users.id.eq(1));
  expectTypeOf(scope).toExtend<WritableScope<"users", UsersColumns>>();
});

test("WritableScope.where chains and stays in scope", () => {
  const scope = users.where(users.id.eq(1)).where(users.active.eq(true));
  expectTypeOf(scope).toExtend<WritableScope<"users", UsersColumns>>();
});

test("WritableScope.delete returns Delete<Columns, null>", () => {
  const built = users.where(users.id.eq(1)).delete();
  expectTypeOf(built).toExtend<Delete<UsersColumns, null>>();
});

test("Table.delete and Table.deleteAll both return Delete<Columns, null>", () => {
  expectTypeOf(users.delete()).toExtend<Delete<UsersColumns, null>>();
  expectTypeOf(users.deleteAll()).toExtend<Delete<UsersColumns, null>>();
});

test(".returning(...) flips Returning to the projected shape", () => {
  const returning = users.where(users.id.eq(1)).delete().returning(users.id);
  expectTypeOf(returning).toExtend<
    Delete<UsersColumns, { readonly id: UsersColumns["id"] }>
  >();
});

test("db.run on a Delete without RETURNING resolves to { rowCount }", () => {
  const result = database.run(users.where(users.id.eq(1)).delete());
  expectTypeOf(result).resolves.toEqualTypeOf<{ readonly rowCount: number }>();
});

test("db.run on a Delete with RETURNING resolves to typed rows", () => {
  const result = database.run(
    users.where(users.id.eq(1)).delete().returning(users.id, users.email),
  );
  expectTypeOf(result).resolves.toEqualTypeOf<
    { id: number; email: string }[]
  >();
});

test("db.run on Table.deleteAll() resolves to { rowCount }", () => {
  const result = database.run(users.deleteAll());
  expectTypeOf(result).resolves.toEqualTypeOf<{ readonly rowCount: number }>();
});

test(".delete is not exposed on a derived Relation (after .order)", () => {
  // .order returns a plain Relation; .delete is not there.
  // @ts-expect-error .delete is not a method on Relation
  users.where(users.id.eq(1)).order(users.id.asc()).delete();
});

test(".delete is not exposed on a joined relation", () => {
  // @ts-expect-error joins return Relation, not WritableScope
  users.innerJoin(posts).on(users.id.eq(posts.authorId)).delete();
});
