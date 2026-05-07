// End-to-end smoke test for INNER JOIN: spin up `users` and `posts`
// in a fresh schema, run a real INNER JOIN, assert both runtime values
// and the static row shape.

import { afterAll, describe, expect, expectTypeOf, it } from "vitest";

import { Database } from "../../src/executor/Database.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { sharedPool, withTestSchema } from "./setup.js";

afterAll(async () => {
  await sharedPool.end();
});

describe("INNER JOIN end-to-end", () => {
  it("joins two tables that share a column name once .project disambiguates", async () => {
    await withTestSchema("tenon_join_shared", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id integer NOT NULL,
             email text NOT NULL
           )`,
        );
        await client.query(
          `CREATE TABLE "${schema}"."teams" (
             id integer NOT NULL,
             name text NOT NULL,
             owner_id integer NOT NULL
           )`,
        );
        await client.query(
          `INSERT INTO "${schema}"."users" (id, email) VALUES
             (1, 'a@example.com'),
             (2, 'b@example.com')`,
        );
        await client.query(
          `INSERT INTO "${schema}"."teams" (id, name, owner_id) VALUES
             (10, 'engineering', 1),
             (11, 'sales', 2)`,
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
      const teams = defineTable(schema, "teams", {
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
        owner_id: columnType<number, "int4">({
          nullable: false,
          hasDefault: false,
          isGenerated: false,
        }),
      });
      const db = new Database(sharedPool);

      const rows = await db.run(
        users
          .innerJoin(teams)
          .on(users.id.eq(teams.owner_id))
          .order(users.id.asc())
          .project(users.email, teams.name),
      );

      expectTypeOf(rows).toEqualTypeOf<{ email: string; name: string }[]>();
      expect(rows).toEqual([
        { email: "a@example.com", name: "engineering" },
        { email: "b@example.com", name: "sales" },
      ]);
    });
  });

  it("returns rows from a self-join via Table.as(alias)", async () => {
    await withTestSchema("tenon_join_self", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id integer NOT NULL,
             email text NOT NULL,
             manager_id integer
           )`,
        );
        await client.query(
          `INSERT INTO "${schema}"."users" (id, email, manager_id) VALUES
             (1, 'boss@example.com', NULL),
             (2, 'a@example.com', 1),
             (3, 'b@example.com', 1)`,
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
        manager_id: columnType<number, "int4">({
          nullable: true,
          hasDefault: false,
          isGenerated: false,
        }),
      });
      const manager = users.as("manager");
      const db = new Database(sharedPool);

      const rows = await db.run(
        users
          .innerJoin(manager)
          .on(users.manager_id.eq(manager.id))
          .order(users.id.asc())
          .project(users.email, manager.email.as("manager_email")),
      );

      expectTypeOf(rows).toEqualTypeOf<
        { email: string; manager_email: string }[]
      >();
      expect(rows).toEqual([
        { email: "a@example.com", manager_email: "boss@example.com" },
        { email: "b@example.com", manager_email: "boss@example.com" },
      ]);
    });
  });

  it("returns rows from both tables with a precise projected row type", async () => {
    await withTestSchema("tenon_join", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id integer NOT NULL,
             email text NOT NULL
           )`,
        );
        await client.query(
          `CREATE TABLE "${schema}"."posts" (
             post_id integer NOT NULL,
             author_id integer NOT NULL,
             body text
           )`,
        );
        await client.query(
          `INSERT INTO "${schema}"."users" (id, email) VALUES
             (1, 'a@example.com'),
             (2, 'b@example.com'),
             (3, 'c@example.com')`,
        );
        await client.query(
          `INSERT INTO "${schema}"."posts" (post_id, author_id, body) VALUES
             (10, 1, 'hello from a'),
             (11, 2, NULL),
             (12, 2, 'second from b')`,
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
      const posts = defineTable(schema, "posts", {
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
      const db = new Database(sharedPool);

      const rows = await db.run(
        users
          .innerJoin(posts)
          .on(users.id.eq(posts.author_id))
          .where(posts.body.isNotNull())
          .order(posts.post_id.asc())
          .project(users.email, posts.body.as("post")),
      );

      expectTypeOf(rows).toEqualTypeOf<
        { email: string; post: string | null }[]
      >();
      expect(rows).toEqual([
        { email: "a@example.com", post: "hello from a" },
        { email: "b@example.com", post: "second from b" },
      ]);
    });
  });
});
