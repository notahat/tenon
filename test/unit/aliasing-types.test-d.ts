// Type-level tests for Table.as(alias).

import { expectTypeOf, test } from "vitest";

import type { Database } from "../../src/executor/Database.js";
import type { Column } from "../../src/query/Column.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import type { ColumnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import type { ForeignKey } from "../../src/schema-runtime/foreignKey.js";

declare const db: Database;

const users = defineTable("public", "users", {
  id: columnType<number, "int4">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
  manager_id: columnType<number, "int4">({
    nullable: true,
    hasDefault: false,
    isGenerated: false,
  }),
  email: columnType<string, "text">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
});

test("as(alias) carries the alias literal in _tableName", () => {
  const aliased = users.as("u");
  expectTypeOf(aliased._tableName).toEqualTypeOf<"u">();
});

test("as(alias) re-tags every column accessor with the new alias", () => {
  const aliased = users.as("u");
  expectTypeOf(aliased.id).toEqualTypeOf<
    Column<"u", "id", ColumnType<number, "int4", false, false, false>>
  >();
  expectTypeOf(aliased.email).toEqualTypeOf<
    Column<"u", "email", ColumnType<string, "text", false, false, false>>
  >();
});

test("the result of .as is still a valid right-hand side for innerJoin", () => {
  // Compiles only when .as preserves the _tableName / _schema constraint.
  void users
    .innerJoin(users.as("manager"))
    .on(users.id.eq(users.as("manager").id));
});

test("self-join with .as runs after .project clears the duplicate brand", () => {
  const manager = users.as("manager");
  const projected = users
    .innerJoin(manager)
    .on(users.manager_id.eq(manager.id))
    .project(users.email, manager.email.as("manager_email"));
  void db.run(projected);
});

test("self-join without .project fails db.run on the duplicate brand", () => {
  const manager = users.as("manager");
  const joined = users.innerJoin(manager).on(users.manager_id.eq(manager.id));
  // @ts-expect-error self-joined relation has duplicate columns; project first
  void db.run(joined);
});

test("_foreignKeys is exposed as a readonly array of ForeignKey", () => {
  expectTypeOf(users._foreignKeys).toEqualTypeOf<readonly ForeignKey[]>();
  expectTypeOf(users.as("u")._foreignKeys).toEqualTypeOf<
    readonly ForeignKey[]
  >();
});
