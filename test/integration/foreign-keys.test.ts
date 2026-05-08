// End-to-end tests for FK-inferred ON predicates: spin up FK-linked
// tables in a fresh schema, define matching tables in TS with FK
// metadata, run real queries through the inference path, and assert
// both the rows and the runtime fallbacks for missing / ambiguous
// FKs.
//
// The catalog-reading half of FK detection lives in
// introspect.test.ts. This file exercises the runtime inference
// path: serialiser sees `on: null` on the InnerJoin AST, looks up
// the FK metadata on the TableRefs, and emits the equivalent
// predicate.

import { afterAll, describe, expect, it } from "vitest";

import { Database } from "../../src/executor/Database.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { sharedPool, withTestSchema } from "./setup.js";

afterAll(async () => {
  await sharedPool.end();
});

describe("FK-inferred INNER JOIN end-to-end", () => {
  it("infers the ON clause from a single-column FK and returns the right rows", async () => {
    await withTestSchema("tenon_fk_join", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id integer PRIMARY KEY,
             email text NOT NULL
           )`,
        );
        await client.query(
          `CREATE TABLE "${schema}"."posts" (
             post_id integer PRIMARY KEY,
             author_id integer NOT NULL REFERENCES "${schema}"."users"(id),
             body text NOT NULL
           )`,
        );
        await client.query(
          `INSERT INTO "${schema}"."users" (id, email) VALUES
             (1, 'a@example.com'),
             (2, 'b@example.com')`,
        );
        await client.query(
          `INSERT INTO "${schema}"."posts" (post_id, author_id, body) VALUES
             (10, 1, 'hello from a'),
             (11, 2, 'hello from b')`,
        );
      } finally {
        client.release();
      }

      const users = defineTable(schema, "users", {
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
      const posts = defineTable(
        schema,
        "posts",
        {
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
            nullable: false,
            hasDefault: false,
            isGenerated: false,
          }),
        },
        [
          {
            name: "posts_author_id_fkey",
            columns: ["author_id"],
            referencedSchema: schema,
            referencedTable: "users",
            referencedColumns: ["id"],
          },
        ] as const,
      );
      const db = new Database(sharedPool);

      const rows = await db.run(
        posts
          .innerJoin(users)
          .order(posts.post_id.asc())
          .project(users.email, posts.body),
      );

      expect(rows).toEqual([
        { email: "a@example.com", body: "hello from a" },
        { email: "b@example.com", body: "hello from b" },
      ]);
    });
  });

  it("returns the same rows when .on(...) is supplied explicitly as the FK", async () => {
    await withTestSchema("tenon_fk_join_override", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id integer PRIMARY KEY,
             email text NOT NULL
           )`,
        );
        await client.query(
          `CREATE TABLE "${schema}"."posts" (
             post_id integer PRIMARY KEY,
             author_id integer NOT NULL REFERENCES "${schema}"."users"(id),
             body text NOT NULL
           )`,
        );
        await client.query(
          `INSERT INTO "${schema}"."users" (id, email) VALUES (1, 'a@x')`,
        );
        await client.query(
          `INSERT INTO "${schema}"."posts" (post_id, author_id, body) VALUES
             (10, 1, 'first'),
             (11, 1, 'second')`,
        );
      } finally {
        client.release();
      }

      const users = defineTable(schema, "users", {
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
      const posts = defineTable(
        schema,
        "posts",
        {
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
            nullable: false,
            hasDefault: false,
            isGenerated: false,
          }),
        },
        [
          {
            name: "posts_author_id_fkey",
            columns: ["author_id"],
            referencedSchema: schema,
            referencedTable: "users",
            referencedColumns: ["id"],
          },
        ] as const,
      );
      const db = new Database(sharedPool);

      const inferred = await db.run(
        posts
          .innerJoin(users)
          .order(posts.post_id.asc())
          .project(posts.body, users.email),
      );
      const explicit = await db.run(
        posts
          .innerJoin(users)
          .on(posts.author_id.eq(users.id))
          .order(posts.post_id.asc())
          .project(posts.body, users.email),
      );

      expect(inferred).toEqual(explicit);
      expect(inferred).toEqual([
        { body: "first", email: "a@x" },
        { body: "second", email: "a@x" },
      ]);
    });
  });

  it("throws a useful error at db.run when no FK connects the two tables", async () => {
    const orphans = defineTable("public", "orphans", {
      id: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
    });
    const others = defineTable("public", "others", {
      id: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
    });
    const db = new Database(sharedPool);

    // The compile-time brand catches this normally; the as-cast
    // bypasses it so we exercise the defensive runtime throw.
    const branded = orphans.innerJoin(others) as unknown as Parameters<
      typeof db.run
    >[0];
    await expect(db.run(branded)).rejects.toThrow(/no foreign key/i);
  });

  it("throws a useful error at db.run when more than one FK connects the two tables", async () => {
    const usersStub = defineTable("public", "users_stub", {
      id: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
    });
    const accounts = defineTable(
      "public",
      "accounts_stub",
      {
        creator_id: columnType<number, "int4">({
          nullable: false,
          hasDefault: false,
          isGenerated: false,
        }),
        owner_id: columnType<number, "int4">({
          nullable: false,
          hasDefault: false,
          isGenerated: false,
        }),
      },
      [
        {
          name: "accounts_creator_id_fkey",
          columns: ["creator_id"],
          referencedSchema: "public",
          referencedTable: "users_stub",
          referencedColumns: ["id"],
        },
        {
          name: "accounts_owner_id_fkey",
          columns: ["owner_id"],
          referencedSchema: "public",
          referencedTable: "users_stub",
          referencedColumns: ["id"],
        },
      ] as const,
    );
    const db = new Database(sharedPool);

    const branded = accounts.innerJoin(usersStub) as unknown as Parameters<
      typeof db.run
    >[0];
    await expect(db.run(branded)).rejects.toThrow(/ambiguous/i);
  });
});
