// Runtime tests for belongs-to accessors wired by defineSchema.
// Type-level coverage lives in belongs-to-types.test-d.ts.

import { describe, expect, it } from "vitest";

import { SingleRow } from "../../src/query/SingleRow.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineSchema } from "../../src/schema-runtime/defineSchema.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { relationToSql } from "../../src/sql/serialise.js";

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

describe("belongs-to accessors", () => {
  it("are merged onto the SingleRow returned by find", () => {
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
    const { posts: wiredPosts } = defineSchema({ users, posts });
    const accessor = (wiredPosts.find(1) as unknown as { author: SingleRow<typeof users._columns> })
      .author;
    expect(accessor).toBeInstanceOf(SingleRow);
  });

  it("emit a join + WHERE on the child's PK + LIMIT 1", () => {
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
    const { posts: wiredPosts } = defineSchema({ users, posts });
    const accessor = (wiredPosts.find(7) as unknown as {
      author: SingleRow<typeof users._columns>;
    }).author;
    const compiled = relationToSql(accessor.node);
    expect(compiled.text).toBe(
      `SELECT "users"."id", "users"."email" FROM "public"."users" ` +
        `INNER JOIN "public"."posts" ON ("users"."id" = "posts"."author_id") ` +
        `WHERE ("posts"."id" = $1) LIMIT 1`,
    );
    expect(compiled.params).toEqual([7]);
  });

  it("strip a trailing _id from the FK column for the accessor name", () => {
    // posts.author_id -> accessor `author`; comments.post_id -> `post`.
    const posts = defineTable("public", "posts", { id: idColumn }, [], {
      columns: ["id"],
    });
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
    const { comments: wiredComments } = defineSchema({ posts, comments });
    const single = wiredComments.find(1) as unknown as {
      post?: SingleRow<typeof posts._columns>;
    };
    expect(single.post).toBeInstanceOf(SingleRow);
  });

  it("fall back to the referenced table's name when the FK column has no _id suffix", () => {
    const owners = defineTable("public", "owners", { id: idColumn }, [], {
      columns: ["id"],
    });
    const things = defineTable(
      "public",
      "things",
      { id: idColumn, owner: fkColumn },
      [
        {
          name: "things_owner_fkey",
          columns: ["owner"],
          referencedSchema: "public",
          referencedTable: "owners",
          referencedColumns: ["id"],
        },
      ],
      { columns: ["id"] },
    );
    const { things: wiredThings } = defineSchema({ owners, things });
    const single = wiredThings.find(1) as unknown as {
      owners?: SingleRow<typeof owners._columns>;
    };
    expect(single.owners).toBeInstanceOf(SingleRow);
  });

  it("disambiguate two FKs to the same target by their column name", () => {
    // messages has FKs sender_id and recipient_id, both -> users.
    // The accessor names derive from the FK columns: `sender` and
    // `recipient`. No ambiguity at the belongs-to level.
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
    const { messages: wiredMessages } = defineSchema({ users, messages });
    const single = wiredMessages.find(1) as unknown as {
      sender?: SingleRow<typeof users._columns>;
      recipient?: SingleRow<typeof users._columns>;
    };
    expect(single.sender).toBeInstanceOf(SingleRow);
    expect(single.recipient).toBeInstanceOf(SingleRow);
  });

  it("skip belongs-to whose target table isn't in the schema bag", () => {
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
      ],
      { columns: ["id"] },
    );
    const { orphans: wiredOrphans } = defineSchema({ orphans });
    const single = wiredOrphans.find(1) as unknown as { missing?: unknown };
    expect(single.missing).toBeUndefined();
  });

  it("skip a belongs-to accessor that would shadow a column on the child", () => {
    // posts has a column named `author` (not author_id), and also an
    // FK `author_id -> users.id` whose accessor name is `author`.
    // The collision rule keeps the column accessor and skips the
    // belongs-to accessor.
    const users = defineTable("public", "users", { id: idColumn }, [], {
      columns: ["id"],
    });
    const posts = defineTable(
      "public",
      "posts",
      { id: idColumn, author: textColumn, author_id: fkColumn },
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
    const { posts: wiredPosts } = defineSchema({ users, posts });
    const single = wiredPosts.find(1);
    // The `author` field on the SingleRow is undefined because the
    // belongs-to was skipped.
    expect((single as unknown as { author?: unknown }).author).toBeUndefined();
  });
});
