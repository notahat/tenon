// Type-level tests for WritableScope.update / WritableSingleRow.update /
// Update.returning / Database.run dispatch. `@ts-expect-error` lines
// document compile errors we rely on.

import { expectTypeOf, test } from "vitest";

import type { Database } from "../../src/executor/Database.js";
import { Update } from "../../src/query/Update.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";

declare const database: Database;

const users = defineTable(
  "public",
  "users",
  {
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
    name: columnType<string, "text">({
      nullable: true,
      hasDefault: false,
      isGenerated: false,
    }),
    active: columnType<boolean, "bool">({
      nullable: false,
      hasDefault: true,
      isGenerated: false,
    }),
    full_name: columnType<string, "text">({
      nullable: false,
      hasDefault: false,
      isGenerated: true,
    }),
  },
  [],
  { columns: ["id"] },
);

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

test("WritableScope.update returns Update<Columns, null>", () => {
  const built = users.where(users.id.eq(1)).update({ name: "Pete" });
  expectTypeOf(built).toMatchTypeOf<Update<UsersColumns, null>>();
});

test("WritableSingleRow.update returns Update<Columns, null>", () => {
  const built = users.find(1).update({ name: "Pete" });
  expectTypeOf(built).toMatchTypeOf<Update<UsersColumns, null>>();
});

test(".returning(...) flips Returning to the projected shape", () => {
  const returning = users
    .where(users.id.eq(1))
    .update({ name: "Pete" })
    .returning(users.id);
  expectTypeOf(returning).toMatchTypeOf<
    Update<UsersColumns, { readonly id: UsersColumns["id"] }>
  >();
});

test("db.run on an Update without RETURNING resolves to { rowCount }", () => {
  const result = database.run(
    users.where(users.id.eq(1)).update({ name: "Pete" }),
  );
  expectTypeOf(result).resolves.toEqualTypeOf<{ readonly rowCount: number }>();
});

test("db.run on an Update with RETURNING resolves to typed rows", () => {
  const result = database.run(
    users
      .where(users.id.eq(1))
      .update({ name: "Pete" })
      .returning(users.id, users.email),
  );
  expectTypeOf(result).resolves.toEqualTypeOf<
    { id: number; email: string }[]
  >();
});

test("update accepts an empty attrs object at the type level", () => {
  // {} typechecks because every key is optional. The serialiser throws
  // at run time; type-level enforcement would add a generic constraint
  // we've judged not worth the cost.
  void users.where(users.id.eq(1)).update({});
});

test("nullable columns accept null in update attrs", () => {
  void users.where(users.id.eq(1)).update({ name: null });
});

test("non-nullable columns reject null in update attrs", () => {
  // @ts-expect-error email is NOT NULL; null is not assignable
  users.where(users.id.eq(1)).update({ email: null });
});

test("generated columns are absent from UpdatableAttrs", () => {
  // @ts-expect-error full_name is generated; not a property of the attrs type
  users.where(users.id.eq(1)).update({ full_name: "x" });
});

test("update is not exposed on a derived Relation (after .order)", () => {
  // .order returns a plain Relation; .update is not there.
  // @ts-expect-error .update is not a method on Relation
  users.where(users.id.eq(1)).order(users.id.asc()).update({ name: "x" });
});

test("update is not exposed on a joined relation", () => {
  // @ts-expect-error joins return Relation, not WritableScope
  users.innerJoin(posts).on(users.id.eq(posts.authorId)).update({});
});

test("update is not exposed on Table directly", () => {
  // @ts-expect-error .update lives on WritableScope / WritableSingleRow only
  users.update({ name: "x" });
});
