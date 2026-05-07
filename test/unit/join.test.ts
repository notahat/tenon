import { describe, expect, it } from "vitest";

import { binaryOp, columnRef } from "../../src/ast/expression.js";
import { innerJoin, tableRef } from "../../src/ast/relation.js";
import { JoinBuilder } from "../../src/query/JoinBuilder.js";
import { Relation } from "../../src/query/Relation.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { relationToSql } from "../../src/sql/serialise.js";

describe("innerJoin factory", () => {
  it("builds an InnerJoin node with the given source, right table, and predicate", () => {
    const left = tableRef({ schema: "public", name: "users" });
    const right = tableRef({ schema: "public", name: "posts" });
    const predicate = binaryOp(
      "=",
      columnRef({ tableAlias: "users", column: "id" }),
      columnRef({ tableAlias: "posts", column: "author_id" }),
    );

    const node = innerJoin(left, right, predicate);

    expect(node).toEqual({
      kind: "InnerJoin",
      source: left,
      right,
      on: predicate,
    });
  });

  it("returns a fresh object on each call (no shared mutable state)", () => {
    const left = tableRef({ schema: "public", name: "users" });
    const right = tableRef({ schema: "public", name: "posts" });
    const predicate = binaryOp(
      "=",
      columnRef({ tableAlias: "users", column: "id" }),
      columnRef({ tableAlias: "posts", column: "author_id" }),
    );

    const a = innerJoin(left, right, predicate);
    const b = innerJoin(left, right, predicate);

    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("Relation.innerJoin().on()", () => {
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

  it("innerJoin returns a JoinBuilder; .on() returns a Relation", () => {
    const builder = users.innerJoin(posts);
    expect(builder).toBeInstanceOf(JoinBuilder);

    const joined = builder.on(users.id.eq(posts.author_id));
    expect(joined).toBeInstanceOf(Relation);
  });

  it("emits the expected SQL for a join + where + project chain", () => {
    const joined = users
      .innerJoin(posts)
      .on(users.id.eq(posts.author_id))
      .where(posts.body.isNotNull())
      .project(users.email, posts.body.as("post"));

    const compiled = relationToSql(joined.node);

    expect(compiled.text).toBe(
      `SELECT "users"."email", "posts"."body" AS "post"` +
        ` FROM "public"."users"` +
        ` INNER JOIN "public"."posts" ON ("users"."id" = "posts"."author_id")` +
        ` WHERE ("posts"."body" IS NOT NULL)`,
    );
    expect(compiled.params).toEqual([]);
  });

  it("supports stacked innerJoins built fluently (left-deep tree)", () => {
    const tags = defineTable("public", "tags", {
      tag_id: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
      post_ref: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
      label: columnType<string, "text">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
    });

    const joined = users
      .innerJoin(posts)
      .on(users.id.eq(posts.author_id))
      .innerJoin(tags)
      .on(posts.post_id.eq(tags.post_ref));

    const compiled = relationToSql(joined.node);

    expect(compiled.text).toBe(
      `SELECT * FROM "public"."users"` +
        ` INNER JOIN "public"."posts" ON ("users"."id" = "posts"."author_id")` +
        ` INNER JOIN "public"."tags" ON ("posts"."post_id" = "tags"."post_ref")`,
    );
  });
});
