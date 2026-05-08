// Type-level tests for has-many accessors wired by defineSchema:
// presence/absence on the SingleRow value, the Relation column shape,
// the AmbiguousHasManyBrand surfacing at db.run, and skip cases for
// self-references and column-name collisions.

import { expectTypeOf, test } from "vitest";

import type { Database } from "../../src/executor/Database.js";
import type { Relation } from "../../src/query/Relation.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineSchema } from "../../src/schema-runtime/defineSchema.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";

declare const database: Database;

const idColumn = columnType<number, "int4">({
  nullable: false,
  hasDefault: true,
  isGenerated: false,
});
const fkColumn = columnType<number, "int4">({
  nullable: false,
  hasDefault: false,
  isGenerated: false,
});
const textColumn = columnType<string, "text">({
  nullable: false,
  hasDefault: false,
  isGenerated: false,
});

const users = defineTable(
  "public",
  "users",
  { id: idColumn, email: textColumn },
  [],
  { columns: ["id"] },
);

const posts = defineTable(
  "public",
  "posts",
  { id: idColumn, author_id: fkColumn, body: textColumn },
  [
    {
      name: "posts_author_id_fkey",
      columns: ["author_id"],
      referencedSchema: "public",
      referencedTable: "users",
      referencedColumns: ["id"],
    },
  ] as const,
  { columns: ["id"] },
);

const schema = defineSchema({ users, posts });

test("the parent's find result exposes a has-many accessor named after the child", () => {
  // The accessor is a Relation parameterised over the child's columns
  // and FKs; `db.run` typing below covers the row shape precisely.
  expectTypeOf(schema.users.find(1).posts).toMatchTypeOf<
    Relation<typeof posts._columns, typeof posts._foreignKeys>
  >();
});

test("the has-many accessor returns a runnable Relation when unambiguous", () => {
  const result = database.run(schema.users.find(1).posts);
  expectTypeOf(result).toEqualTypeOf<
    Promise<{ id: number; author_id: number; body: string }[]>
  >();
});

test("the has-many accessor is absent on the child side", () => {
  // posts has an FK to users, not the other way round.
  // @ts-expect-error users is not a child of posts
  void schema.posts.find(1).users;
});

test("ambiguous has-many surfaces a brand at db.run", () => {
  const messages = defineTable(
    "public",
    "messages",
    { id: idColumn, sender_id: fkColumn, recipient_id: fkColumn },
    [
      {
        name: "messages_sender_id_fkey",
        columns: ["sender_id"],
        referencedSchema: "public",
        referencedTable: "users",
        referencedColumns: ["id"],
      },
      {
        name: "messages_recipient_id_fkey",
        columns: ["recipient_id"],
        referencedSchema: "public",
        referencedTable: "users",
        referencedColumns: ["id"],
      },
    ] as const,
    { columns: ["id"] },
  );
  const ambig = defineSchema({ users, messages });
  // @ts-expect-error AmbiguousHasManyBrand blocks db.run
  void database.run(ambig.users.find(1).messages);
});

test("a self-FK does not produce an accessor on the parent's own physical name", () => {
  const employees = defineTable(
    "public",
    "employees",
    { id: idColumn, manager_id: fkColumn },
    [
      {
        name: "employees_manager_id_fkey",
        columns: ["manager_id"],
        referencedSchema: "public",
        referencedTable: "employees",
        referencedColumns: ["id"],
      },
    ] as const,
    { columns: ["id"] },
  );
  const empSchema = defineSchema({ employees });
  // @ts-expect-error self-FK skipped at the type level
  void empSchema.employees.find(1).employees;
});

test("a has-many accessor that would shadow a column on the parent is skipped", () => {
  const parents = defineTable(
    "public",
    "parents",
    { id: idColumn, children: textColumn },
    [],
    { columns: ["id"] },
  );
  const children = defineTable(
    "public",
    "children",
    { id: idColumn, parent_id: fkColumn },
    [
      {
        name: "children_parent_id_fkey",
        columns: ["parent_id"],
        referencedSchema: "public",
        referencedTable: "parents",
        referencedColumns: ["id"],
      },
    ] as const,
    { columns: ["id"] },
  );
  const collidingSchema = defineSchema({ parents, children });
  const single = collidingSchema.parents.find(1);
  // The has-many accessor `children` would collide with the parent's
  // own column named `children`; defineSchema skips it. SingleRow
  // doesn't expose column accessors, so neither side surfaces a
  // `children` property at the type level.
  // @ts-expect-error has-many accessor skipped due to column-name shadow
  void single.children;
});
