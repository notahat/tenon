// Type-level tests for inner-join. Mirrors `types.test-d.ts`: positive
// expectations via `expectTypeOf`, regressions guarded by
// `@ts-expect-error`.

import { expectTypeOf, test } from "vitest";

import type { Database } from "../../src/executor/Database.js";
import { JoinBuilder } from "../../src/query/JoinBuilder.js";
import { Relation } from "../../src/query/Relation.js";
import type { RowOf } from "../../src/query/types.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";

declare const db: Database;

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
});

const posts = defineTable("public", "posts", {
  post_id: columnType<number, "int4">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
  author_id: columnType<number, "int4">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
  body: columnType<string, "text">({
    nullable: true,
    hasDefault: false,
    isGenerated: false,
  }),
});

const teams = defineTable("public", "teams", {
  // Shares `id` with `users` to exercise the collision branch.
  id: columnType<number, "int4">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
  name: columnType<string, "text">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
});

test("innerJoin returns a JoinBuilder, not a Relation", () => {
  expectTypeOf(users.innerJoin(posts)).toMatchTypeOf<
    JoinBuilder<
      typeof users._columns,
      typeof users._foreignKeys,
      typeof users._schema,
      typeof users._physicalName,
      typeof posts._columns,
      typeof posts._foreignKeys,
      typeof posts._schema,
      typeof posts._physicalName
    >
  >();
});

test(".on completes the join into a Relation", () => {
  const joined = users.innerJoin(posts).on(users.id.eq(posts.author_id));
  expectTypeOf(joined).toMatchTypeOf<
    Relation<typeof users._columns & typeof posts._columns>
  >();
});

test("the joined relation row shape is the union of both tables", () => {
  const joined = users.innerJoin(posts).on(users.id.eq(posts.author_id));
  expectTypeOf<RowOf<(typeof joined)["_columns"]>>().toEqualTypeOf<{
    id: number;
    email: string;
    post_id: number;
    author_id: number;
    body: string | null;
  }>();
});

test("the joined relation accepts predicates referencing either side", () => {
  const joined = users.innerJoin(posts).on(users.id.eq(posts.author_id));
  // Both single- and multi-side predicates compile.
  void joined.where(users.email.eq("a@b"));
  void joined.where(posts.body.isNotNull());
  void joined.where(users.id.eq(posts.author_id));
});

test("the joined relation projects to a precise row shape", () => {
  const projected = users
    .innerJoin(posts)
    .on(users.id.eq(posts.author_id))
    .project(users.email, posts.body.as("post"));
  expectTypeOf<RowOf<(typeof projected)["_columns"]>>().toEqualTypeOf<{
    email: string;
    post: string | null;
  }>();
});

test("JoinBuilder is itself a Relation: .where() composes before .on()", () => {
  // Since v1.10 JoinBuilder extends Relation so the join is runnable
  // directly (the serialiser fills in ON from FK metadata) and every
  // read operator works on it. `.where()` returns a plain Relation,
  // shedding `.on()` from the type — that's intentional.
  expectTypeOf(
    users.innerJoin(posts).where(posts.body.isNotNull()),
  ).not.toBeAny();
});

test(".on() requires an Expression<boolean>", () => {
  // @ts-expect-error a bare Column is not an Expression
  users.innerJoin(posts).on(users.id);
});

test("innerJoin requires a defined table on the right", () => {
  const filteredPosts = posts.where(posts.body.isNotNull());
  // @ts-expect-error a derived Relation<...> lacks _tableName / _schema
  users.innerJoin(filteredPosts);
});

test("joins between tables sharing a column name typecheck at .on()", () => {
  // users and teams both have `id`; the predicate compiles fine.
  const joined = users.innerJoin(teams).on(users.id.eq(teams.id));
  // .where on the merged relation also compiles, even with the
  // duplicate column hanging around in the merged shape.
  void joined.where(users.email.eq("a@b"));
});

test("db.run rejects a joined relation with duplicate column names", () => {
  const joined = users.innerJoin(teams).on(users.id.eq(teams.id));
  // @ts-expect-error duplicate `id` in the merged shape: must project first
  void db.run(joined);
});

test(".project clears the duplicate-column brand so db.run accepts it", () => {
  const projected = users
    .innerJoin(teams)
    .on(users.id.eq(teams.id))
    .project(users.email, teams.name);
  // Projection narrows to a fresh shape with no duplicate keys.
  void db.run(projected);
});
