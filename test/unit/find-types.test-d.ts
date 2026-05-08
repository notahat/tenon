// Type-level tests for Table.find and the SingleRow / SingleRowOrThrow
// surface threaded through Database.run.

import { expectTypeOf, test } from "vitest";

import type { Database } from "../../src/executor/Database.js";
import type { Delete } from "../../src/query/Delete.js";
import type {
  DeletableSingleRow,
  SingleRowOrThrow,
} from "../../src/query/SingleRow.js";
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
  },
  [],
  { columns: ["id"] },
);

const eventsNoPk = defineTable("public", "events", {
  id: columnType<number, "int4">({
    nullable: false,
    hasDefault: true,
    isGenerated: false,
  }),
});

const tenantUsersComposite = defineTable(
  "public",
  "tenant_users",
  {
    tenant_id: columnType<number, "int4">({
      nullable: false,
      hasDefault: false,
      isGenerated: false,
    }),
    user_id: columnType<number, "int4">({
      nullable: false,
      hasDefault: false,
      isGenerated: false,
    }),
  },
  [],
  { columns: ["tenant_id", "user_id"] },
);

type UsersColumns = (typeof users)["_columns"];

test("find returns a DeletableSingleRow over the table's columns", () => {
  expectTypeOf(users.find(1)).toEqualTypeOf<
    DeletableSingleRow<UsersColumns>
  >();
});

test("find's argument is typed by the primary-key column", () => {
  // @ts-expect-error id is int4; a string is not assignable
  users.find("not a number");
  // numeric literal compiles
  void users.find(7);
});

test("find is absent on tables without a primary key", () => {
  // @ts-expect-error events has no PK; find does not exist
  void eventsNoPk.find;
});

test("find is absent on tables with a composite primary key", () => {
  // @ts-expect-error composite PK; find does not exist (v1 limitation)
  void tenantUsersComposite.find;
});

test("orThrow promotes SingleRow to SingleRowOrThrow", () => {
  expectTypeOf(users.find(1).orThrow()).toEqualTypeOf<
    SingleRowOrThrow<UsersColumns>
  >();
});

test("db.run on a SingleRow resolves to RowOf<C> | null", () => {
  expectTypeOf(database.run(users.find(1))).toEqualTypeOf<
    Promise<{ id: number; email: string } | null>
  >();
});

test("db.run on a SingleRowOrThrow resolves to RowOf<C>", () => {
  expectTypeOf(database.run(users.find(1).orThrow())).toEqualTypeOf<
    Promise<{ id: number; email: string }>
  >();
});

test("find().delete() returns a Delete with no RETURNING projection", () => {
  expectTypeOf(users.find(1).delete()).toEqualTypeOf<
    Delete<UsersColumns, null>
  >();
});

test("db.run on find().delete() resolves to a rowCount summary", () => {
  expectTypeOf(database.run(users.find(1).delete())).toEqualTypeOf<
    Promise<{ readonly rowCount: number }>
  >();
});

test("delete is absent on the orThrow form", () => {
  // @ts-expect-error orThrow is read-only; no delete on this branch
  void users.find(1).orThrow().delete;
});

test("delete is absent on tables without a single-column primary key", () => {
  // @ts-expect-error no find means no path to delete via find
  void eventsNoPk.find;
  // @ts-expect-error composite PK has no find either
  void tenantUsersComposite.find;
});
