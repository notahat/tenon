// Type-level tests for inner-join. Mirrors `types.test-d.ts`: positive
// expectations via `expectTypeOf`, regressions guarded by
// `@ts-expect-error`.

import { expectTypeOf, test } from "vitest";

import { JoinBuilder } from "../../src/query/JoinBuilder.js";
import { Relation } from "../../src/query/Relation.js";
import type { RowOf } from "../../src/query/types.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";

const users = defineTable("public", "users", {
  id: columnType<number, "int4">({ nullable: false }),
  email: columnType<string, "text">({ nullable: false }),
});

const posts = defineTable("public", "posts", {
  post_id: columnType<number, "int4">({ nullable: false }),
  author_id: columnType<number, "int4">({ nullable: false }),
  body: columnType<string, "text">({ nullable: true }),
});

const teams = defineTable("public", "teams", {
  // Shares `id` with `users` to exercise the collision branch.
  id: columnType<number, "int4">({ nullable: false }),
  name: columnType<string, "text">({ nullable: false }),
});

test("innerJoin returns a JoinBuilder, not a Relation", () => {
  expectTypeOf(users.innerJoin(posts)).toMatchTypeOf<
    JoinBuilder<typeof users._columns, typeof posts._columns>
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

test("JoinBuilder exposes only .on() — chaining .where() before .on() fails", () => {
  // @ts-expect-error JoinBuilder has no .where method
  users.innerJoin(posts).where(posts.body.isNotNull());
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

test("colliding column names produce a compile error at the call site", () => {
  // @ts-expect-error users and teams both expose `id`
  users.innerJoin(teams).on(users.id.eq(teams.id));
});
