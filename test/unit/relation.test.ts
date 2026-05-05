import { describe, expect, it } from "vitest";

import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { relationToSql } from "../../src/sql/serialise.js";

const users = defineTable("public", "users", {
  id: columnType<number, "int4">({ nullable: false }),
  email: columnType<string, "text">({ nullable: false }),
  age: columnType<number, "int4">({ nullable: true }),
});

describe("Relation.where", () => {
  it("emits a WHERE clause with a parameter", () => {
    const compiled = relationToSql(users.where(users.id.eq(1)).node);
    expect(compiled.text).toBe(
      `SELECT * FROM "public"."users" WHERE ("users"."id" = $1)`,
    );
    expect(compiled.params).toEqual([1]);
  });

  it("combines chained where calls with AND in source-tree order", () => {
    const compiled = relationToSql(
      users.where(users.id.eq(1)).where(users.email.eq("a@b")).node,
    );
    expect(compiled.text).toBe(
      `SELECT * FROM "public"."users"` +
        ` WHERE ("users"."id" = $1) AND ("users"."email" = $2)`,
    );
    expect(compiled.params).toEqual([1, "a@b"]);
  });

  it("renders combined boolean expressions inside a single where", () => {
    const compiled = relationToSql(
      users.where(users.id.eq(1).or(users.id.eq(2))).node,
    );
    expect(compiled.text).toBe(
      `SELECT * FROM "public"."users"` +
        ` WHERE (("users"."id" = $1) OR ("users"."id" = $2))`,
    );
    expect(compiled.params).toEqual([1, 2]);
  });

  it("renders IS NULL and IS NOT NULL via the unary operators", () => {
    const compiled = relationToSql(users.where(users.age.isNull()).node);
    expect(compiled.text).toContain(`("users"."age" IS NULL)`);
  });

  it("renders IN lists with each value as its own parameter", () => {
    const compiled = relationToSql(users.where(users.id.in([1, 2, 3])).node);
    expect(compiled.text).toContain(`("users"."id" IN ($1, $2, $3))`);
    expect(compiled.params).toEqual([1, 2, 3]);
  });
});

describe("Relation.order", () => {
  it("emits ORDER BY with the given direction", () => {
    const compiled = relationToSql(users.order(users.id.desc()).node);
    expect(compiled.text).toContain(`ORDER BY "users"."id" DESC`);
  });

  it("emits multiple terms separated by commas", () => {
    const compiled = relationToSql(
      users.order(users.email.asc(), users.id.desc()).node,
    );
    expect(compiled.text).toContain(
      `ORDER BY "users"."email" ASC, "users"."id" DESC`,
    );
  });

  it("uses the outermost order call when chained (outer wins)", () => {
    const compiled = relationToSql(
      users.order(users.id.asc()).order(users.email.desc()).node,
    );
    expect(compiled.text).toContain(`ORDER BY "users"."email" DESC`);
    expect(compiled.text).not.toContain(`"users"."id" ASC`);
  });
});

describe("Relation.limit and Relation.offset", () => {
  it("emits LIMIT", () => {
    const compiled = relationToSql(users.limit(10).node);
    expect(compiled.text).toContain("LIMIT 10");
  });

  it("emits OFFSET", () => {
    const compiled = relationToSql(users.offset(5).node);
    expect(compiled.text).toContain("OFFSET 5");
  });

  it("emits LIMIT before OFFSET in canonical order", () => {
    const compiled = relationToSql(users.limit(10).offset(20).node);
    expect(compiled.text.endsWith("LIMIT 10 OFFSET 20")).toBe(true);
  });

  it("uses outermost limit when chained", () => {
    const compiled = relationToSql(users.limit(5).limit(10).node);
    expect(compiled.text).toContain("LIMIT 10");
    expect(compiled.text).not.toContain("LIMIT 5");
  });
});

describe("Clause ordering", () => {
  it("emits clauses in canonical order: WHERE, ORDER BY, LIMIT, OFFSET", () => {
    const compiled = relationToSql(
      users.where(users.id.eq(1)).order(users.email.asc()).limit(10).offset(20)
        .node,
    );
    expect(compiled.text).toBe(
      `SELECT * FROM "public"."users"` +
        ` WHERE ("users"."id" = $1)` +
        ` ORDER BY "users"."email" ASC` +
        ` LIMIT 10 OFFSET 20`,
    );
    expect(compiled.params).toEqual([1]);
  });

  it("preserves left-to-right parameter numbering across clauses", () => {
    const compiled = relationToSql(
      users
        .where(users.id.eq(1))
        .where(users.email.eq("a@b"))
        .where(users.age.gt(18)).node,
    );
    expect(compiled.params).toEqual([1, "a@b", 18]);
  });
});
