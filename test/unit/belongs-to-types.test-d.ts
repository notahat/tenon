// Type-level tests for belongs-to accessors wired by defineSchema.
// Covers presence, naming derivation, the single-row return shape,
// db.run typing, and skip cases (column shadow, target outside the
// schema bag).

import { expectTypeOf, test } from "vitest";

import type { Database } from "../../src/executor/Database.js";
import type { SingleRow } from "../../src/query/SingleRow.js";
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

test("the child's find result exposes a belongs-to accessor named by stripping _id", () => {
  // posts.author_id -> accessor `author` over users columns.
  expectTypeOf(schema.posts.find(1).author).toMatchTypeOf<
    SingleRow<typeof users._columns>
  >();
});

test("db.run on the belongs-to accessor resolves to RowOf<C>", () => {
  expectTypeOf(database.run(schema.posts.find(1).author)).toEqualTypeOf<
    Promise<{ id: number; email: string }>
  >();
});

test("the belongs-to accessor has no .orThrow (find throws by default)", () => {
  // @ts-expect-error orThrow was removed; SingleRow now throws on miss
  void schema.posts.find(1).author.orThrow;
});

test("the belongs-to accessor is absent on the parent side", () => {
  // users -> posts is has-many, not belongs-to.
  // @ts-expect-error users does not belong to posts
  void schema.users.find(1).author;
});

test("the belongs-to accessor is a plain SingleRow without delete", () => {
  // Belongs-to chains wrap an inner-join relation, not a flat WHERE,
  // so they intentionally don't expose .delete(). Only the find-rooted
  // SingleRow does.
  // @ts-expect-error belongs-to accessor is plain SingleRow
  void schema.posts.find(1).author.delete;
});

test("two FKs to the same parent disambiguate by FK column name", () => {
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
  const messageSchema = defineSchema({ users, messages });
  expectTypeOf(messageSchema.messages.find(1).sender).toMatchTypeOf<
    SingleRow<typeof users._columns>
  >();
  expectTypeOf(messageSchema.messages.find(1).recipient).toMatchTypeOf<
    SingleRow<typeof users._columns>
  >();
});

test("a belongs-to accessor that would shadow a column on the child is skipped", () => {
  const taggedUsers = defineTable("public", "users", { id: idColumn }, [], {
    columns: ["id"],
  });
  const taggedPosts = defineTable(
    "public",
    "posts",
    {
      id: idColumn,
      // The text column `author` shadows the would-be `author`
      // accessor derived from `author_id`.
      author: textColumn,
      author_id: fkColumn,
    },
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
  const shadowedSchema = defineSchema({
    users: taggedUsers,
    posts: taggedPosts,
  });
  // SingleRow doesn't expose column accessors; the belongs-to was
  // skipped due to column-name shadow, so neither side surfaces
  // `author` on the SingleRow at the type level.
  // @ts-expect-error belongs-to accessor skipped due to column-name shadow
  void shadowedSchema.posts.find(1).author;
});

test("a belongs-to whose target isn't in the schema bag has no accessor", () => {
  const orphans = defineTable(
    "public",
    "orphans",
    { id: idColumn, missing_id: fkColumn },
    [
      {
        name: "orphans_missing_id_fkey",
        columns: ["missing_id"],
        referencedSchema: "public",
        referencedTable: "absent",
        referencedColumns: ["id"],
      },
    ] as const,
    { columns: ["id"] },
  );
  const orphanSchema = defineSchema({ orphans });
  // @ts-expect-error target not in schema, so no accessor
  void orphanSchema.orphans.find(1).missing;
});
