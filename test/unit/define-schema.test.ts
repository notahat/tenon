// Runtime tests for `defineSchema` and the has-many accessors it
// merges onto SingleRow values. Type-level tests live in
// has-many-types.test-d.ts.

import { describe, expect, it } from "vitest";

import { Relation } from "../../src/query/Relation.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineSchema } from "../../src/schema-runtime/defineSchema.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { relationToSql } from "../../src/sql/serialise.js";

const idColumn = columnType<number, "int4">({
  nullable: false,
  hasDefault: true,
  isGenerated: false,
});
const textColumn = columnType<string, "text">({
  nullable: false,
  hasDefault: false,
  isGenerated: false,
});
const fkColumn = columnType<number, "int4">({
  nullable: false,
  hasDefault: false,
  isGenerated: false,
});

describe("defineSchema", () => {
  it("returns the same input record (mutation in place)", () => {
    const tables = {
      users: defineTable("public", "users", { id: idColumn }, [], {
        columns: ["id"],
      }),
    };
    const wired = defineSchema(tables);
    expect(wired).toBe(tables);
  });

  it("merges has-many accessors onto SingleRow returned by find", () => {
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
      ],
      { columns: ["id"] },
    );
    const { users: wiredUsers } = defineSchema({ users, posts });

    const single = wiredUsers.find(1);
    const accessor = (
      single as unknown as { posts: Relation<typeof posts._columns> }
    ).posts;
    expect(accessor).toBeInstanceOf(Relation);
  });

  it("emits a child WHERE-on-FK SQL for has-many accessors", () => {
    const users = defineTable("public", "users", { id: idColumn }, [], {
      columns: ["id"],
    });
    const posts = defineTable(
      "public",
      "posts",
      { id: idColumn, author_id: fkColumn },
      [
        {
          name: "posts_author_id_fkey",
          columns: ["author_id"],
          referencedSchema: "public",
          referencedTable: "users",
          referencedColumns: ["id"],
        },
      ],
      { columns: ["id"] },
    );
    const { users: wiredUsers } = defineSchema({ users, posts });

    const accessor = (
      wiredUsers.find(42) as unknown as {
        posts: Relation<typeof posts._columns>;
      }
    ).posts;
    const compiled = relationToSql(accessor.node);
    expect(compiled.text).toBe(
      `SELECT * FROM "public"."posts" WHERE ("posts"."author_id" = $1)`,
    );
    expect(compiled.params).toEqual([42]);
  });

  it("skips ambiguous has-many (multiple FKs from child to parent)", () => {
    const users = defineTable("public", "users", { id: idColumn }, [], {
      columns: ["id"],
    });
    const messages = defineTable(
      "public",
      "messages",
      {
        id: idColumn,
        sender_id: fkColumn,
        recipient_id: fkColumn,
        body: textColumn,
      },
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
      ],
      { columns: ["id"] },
    );
    const { users: wiredUsers } = defineSchema({ users, messages });

    expect(
      (wiredUsers.find(1) as unknown as { messages?: unknown }).messages,
    ).toBeUndefined();
  });

  it("skips a has-many accessor that would shadow a column on the parent", () => {
    // The parent has a column named `comments`, so the child table's
    // accessor (also `comments`) is dropped to avoid the collision.
    const posts = defineTable(
      "public",
      "posts",
      { id: idColumn, comments: textColumn },
      [],
      { columns: ["id"] },
    );
    const comments = defineTable(
      "public",
      "comments",
      { id: idColumn, post_id: fkColumn },
      [
        {
          name: "comments_post_id_fkey",
          columns: ["post_id"],
          referencedSchema: "public",
          referencedTable: "posts",
          referencedColumns: ["id"],
        },
      ],
      { columns: ["id"] },
    );
    const { posts: wiredPosts } = defineSchema({ posts, comments });
    const single = wiredPosts.find(1);
    // The `comments` property on the SingleRow is the column accessor
    // inherited from posts (a Column instance — but it shouldn't be
    // there at all on a SingleRow). Practically, nothing should be
    // assigned by defineSchema for this name.
    expect(
      (single as unknown as { comments?: unknown }).comments,
    ).toBeUndefined();
  });

  it("does not add a self-referential has-many on the parent's own physical name", () => {
    // A self-FK (employees.manager_id -> employees.id) would create
    // an `employees.employees` accessor; skip it.
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
      ],
      { columns: ["id"] },
    );
    const { employees: wiredEmployees } = defineSchema({ employees });
    expect(
      (wiredEmployees.find(1) as unknown as { employees?: unknown }).employees,
    ).toBeUndefined();
  });

  it("leaves tables without `find` (composite or no PK) untouched", () => {
    const eventsNoPk = defineTable("public", "events", { id: idColumn });
    const result = defineSchema({ eventsNoPk });
    expect((result.eventsNoPk as { find?: unknown }).find).toBeUndefined();
  });
});
