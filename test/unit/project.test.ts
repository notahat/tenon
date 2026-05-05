import { describe, expect, it } from "vitest";

import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { relationToSql } from "../../src/sql/serialise.js";

const users = defineTable("public", "users", {
  id: columnType<number, "int4">({ nullable: false }),
  email: columnType<string, "text">({ nullable: false }),
  age: columnType<number, "int4">({ nullable: true }),
});

describe("Relation.project", () => {
  it("emits a single bare column without an AS clause", () => {
    const compiled = relationToSql(users.project(users.id).node);
    expect(compiled.text).toBe(`SELECT "users"."id" FROM "public"."users"`);
  });

  it("emits multiple columns separated by commas", () => {
    const compiled = relationToSql(users.project(users.id, users.email).node);
    expect(compiled.text).toBe(
      `SELECT "users"."id", "users"."email" FROM "public"."users"`,
    );
  });

  it("emits AS when an alias renames the output", () => {
    const compiled = relationToSql(
      users.project(users.id.as("userId"), users.email).node,
    );
    expect(compiled.text).toBe(
      `SELECT "users"."id" AS "userId", "users"."email"` +
        ` FROM "public"."users"`,
    );
  });

  it("composes with where, order, limit in canonical order", () => {
    const compiled = relationToSql(
      users
        .project(users.id, users.email)
        .where(users.age.gt(18))
        .order(users.email.asc())
        .limit(10).node,
    );
    expect(compiled.text).toBe(
      `SELECT "users"."id", "users"."email" FROM "public"."users"` +
        ` WHERE ("users"."age" > $1)` +
        ` ORDER BY "users"."email" ASC` +
        ` LIMIT 10`,
    );
    expect(compiled.params).toEqual([18]);
  });

  it("uses outermost project when chained", () => {
    const compiled = relationToSql(
      users.project(users.id, users.email).project(users.id).node,
    );
    expect(compiled.text).toBe(`SELECT "users"."id" FROM "public"."users"`);
  });
});
