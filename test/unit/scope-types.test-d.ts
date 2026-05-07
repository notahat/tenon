// Type-level tests for the `scope` helper. Each `@ts-expect-error`
// line documents a compile error we rely on; if the surrounding code
// starts compiling, the directive flags the regression.

import { expectTypeOf, test } from "vitest";

import type { Relation } from "../../src/query/Relation.js";
import { scope, type Scope } from "../../src/query/scope.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";

const users = defineTable("public", "users", {
  id: columnType<number, "int4">({ nullable: false }),
  email: columnType<string, "text">({ nullable: false }),
  active: columnType<boolean, "bool">({ nullable: false }),
});

type UsersColumns = (typeof users)["_columns"];

test("the body's relation parameter infers from the anchor table", () => {
  scope(users, (relation) => {
    expectTypeOf(relation).toMatchTypeOf<Relation<UsersColumns>>();
    return relation;
  });
});

test("scope returns a transform with the table's column shape", () => {
  const active = scope(users, (relation) =>
    relation.where(users.active.eq(true)),
  );

  expectTypeOf(active).toEqualTypeOf<Scope<UsersColumns>>();
});

test("scope's body must return a relation of the same shape", () => {
  // @ts-expect-error scope bodies must return a Relation, not a raw value
  scope(users, () => 42);
});

test("scope rejects bodies whose column predicate refers to the wrong type", () => {
  scope(users, (relation) =>
    relation.where(
      // @ts-expect-error active is a boolean column, not a string
      users.active.eq("yes"),
    ),
  );
});

test("the returned scope only applies to relations of the matching shape", () => {
  const active = scope(users, (relation) =>
    relation.where(users.active.eq(true)),
  );

  const posts = defineTable("public", "posts", {
    id: columnType<number, "int4">({ nullable: false }),
    body: columnType<string, "text">({ nullable: false }),
  });

  // @ts-expect-error a users-bound scope cannot be applied to posts
  active(posts);

  expectTypeOf(active(users)).toMatchTypeOf<Relation<UsersColumns>>();
});
