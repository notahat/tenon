// End-to-end tests for FK association accessors: spin up real
// tables in a fresh schema, wire them with `defineSchema`, and
// exercise `find`, has-many, and belongs-to accessors against
// actual rows.

import { afterAll, describe, expect, it } from "vitest";

import { Database } from "../../src/executor/Database.js";
import { RowNotFoundError } from "../../src/query/SingleRow.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineSchema } from "../../src/schema-runtime/defineSchema.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { sharedPool, withTestSchema } from "./setup.js";

afterAll(async () => {
  await sharedPool.end();
});

const idColumn = columnType<number, "int4">({
  nullable: false,
  hasDefault: false,
  isGenerated: false,
});
const nullableIdColumn = columnType<number, "int4">({
  nullable: true,
  hasDefault: false,
  isGenerated: false,
});
const textColumn = columnType<string, "text">({
  nullable: false,
  hasDefault: false,
  isGenerated: false,
});

describe("FK accessors end-to-end", () => {
  it("Table.find returns the matching row and null when missing", async () => {
    await withTestSchema("tenon_find", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id integer PRIMARY KEY,
             email text NOT NULL
           )`,
        );
        await client.query(
          `INSERT INTO "${schema}"."users" (id, email) VALUES
             (1, 'a@example.com'),
             (2, 'b@example.com')`,
        );
      } finally {
        client.release();
      }

      const { users } = defineSchema({
        users: defineTable(
          schema,
          "users",
          { id: idColumn, email: textColumn },
          [],
          { columns: ["id"] },
        ),
      });

      const db = new Database(sharedPool);
      const found = await db.run(users.find(1));
      expect(found).toEqual({ id: 1, email: "a@example.com" });
      const missing = await db.run(users.find(999));
      expect(missing).toBeNull();
    });
  });

  it("find().delete() removes the row and reports rowCount: 1; missing id reports 0", async () => {
    await withTestSchema("tenon_find_delete", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id integer PRIMARY KEY,
             email text NOT NULL
           )`,
        );
        await client.query(
          `INSERT INTO "${schema}"."users" (id, email) VALUES
             (1, 'a@example.com'),
             (2, 'b@example.com')`,
        );
      } finally {
        client.release();
      }

      const { users } = defineSchema({
        users: defineTable(
          schema,
          "users",
          { id: idColumn, email: textColumn },
          [],
          { columns: ["id"] },
        ),
      });

      const db = new Database(sharedPool);
      const deleted = await db.run(users.find(1).delete());
      expect(deleted).toEqual({ rowCount: 1 });

      const remaining = await db.run(users.find(1));
      expect(remaining).toBeNull();

      const stillThere = await db.run(users.find(2));
      expect(stillThere).toEqual({ id: 2, email: "b@example.com" });

      const missing = await db.run(users.find(999).delete());
      expect(missing).toEqual({ rowCount: 0 });
    });
  });

  it("orThrow rejects with RowNotFoundError when no row matches", async () => {
    await withTestSchema("tenon_or_throw", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id integer PRIMARY KEY,
             email text NOT NULL
           )`,
        );
      } finally {
        client.release();
      }

      const { users } = defineSchema({
        users: defineTable(
          schema,
          "users",
          { id: idColumn, email: textColumn },
          [],
          { columns: ["id"] },
        ),
      });

      const db = new Database(sharedPool);
      await expect(db.run(users.find(1).orThrow())).rejects.toBeInstanceOf(
        RowNotFoundError,
      );
    });
  });

  it("has-many accessor returns the rows linked by FK", async () => {
    await withTestSchema("tenon_has_many", async (schema) => {
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
             id integer PRIMARY KEY,
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
          `INSERT INTO "${schema}"."posts" (id, author_id, body) VALUES
             (10, 1, 'hello from a'),
             (11, 1, 'second from a'),
             (12, 2, 'hello from b')`,
        );
      } finally {
        client.release();
      }

      const { users } = defineSchema({
        users: defineTable(
          schema,
          "users",
          { id: idColumn, email: textColumn },
          [],
          { columns: ["id"] },
        ),
        posts: defineTable(
          schema,
          "posts",
          {
            id: idColumn,
            author_id: idColumn,
            body: textColumn,
          },
          [
            {
              name: "posts_author_id_fkey",
              columns: ["author_id"],
              referencedSchema: schema,
              referencedTable: "users",
              referencedColumns: ["id"],
            },
          ],
          { columns: ["id"] },
        ),
      });

      const db = new Database(sharedPool);
      const result = await db.run(users.find(1).posts);
      expect(result.map((post) => post.body).sort()).toEqual([
        "hello from a",
        "second from a",
      ]);
    });
  });

  it("belongs-to accessor returns the parent row reachable via FK", async () => {
    await withTestSchema("tenon_belongs_to", async (schema) => {
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
             id integer PRIMARY KEY,
             author_id integer NOT NULL REFERENCES "${schema}"."users"(id),
             body text NOT NULL
           )`,
        );
        await client.query(
          `INSERT INTO "${schema}"."users" (id, email) VALUES
             (1, 'a@example.com')`,
        );
        await client.query(
          `INSERT INTO "${schema}"."posts" (id, author_id, body) VALUES
             (10, 1, 'hello from a')`,
        );
      } finally {
        client.release();
      }

      const { posts } = defineSchema({
        users: defineTable(
          schema,
          "users",
          { id: idColumn, email: textColumn },
          [],
          { columns: ["id"] },
        ),
        posts: defineTable(
          schema,
          "posts",
          {
            id: idColumn,
            author_id: idColumn,
            body: textColumn,
          },
          [
            {
              name: "posts_author_id_fkey",
              columns: ["author_id"],
              referencedSchema: schema,
              referencedTable: "users",
              referencedColumns: ["id"],
            },
          ],
          { columns: ["id"] },
        ),
      });

      const db = new Database(sharedPool);
      const author = await db.run(posts.find(10).author);
      expect(author).toEqual({ id: 1, email: "a@example.com" });
    });
  });

  it("two FKs to the same parent disambiguate by FK column on the belongs-to side", async () => {
    await withTestSchema("tenon_two_fks", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id integer PRIMARY KEY,
             email text NOT NULL
           )`,
        );
        await client.query(
          `CREATE TABLE "${schema}"."messages" (
             id integer PRIMARY KEY,
             sender_id integer NOT NULL REFERENCES "${schema}"."users"(id),
             recipient_id integer NOT NULL REFERENCES "${schema}"."users"(id)
           )`,
        );
        await client.query(
          `INSERT INTO "${schema}"."users" (id, email) VALUES
             (1, 'sender@example.com'),
             (2, 'recipient@example.com')`,
        );
        await client.query(
          `INSERT INTO "${schema}"."messages" (id, sender_id, recipient_id) VALUES
             (100, 1, 2)`,
        );
      } finally {
        client.release();
      }

      const { messages } = defineSchema({
        users: defineTable(
          schema,
          "users",
          { id: idColumn, email: textColumn },
          [],
          { columns: ["id"] },
        ),
        messages: defineTable(
          schema,
          "messages",
          { id: idColumn, sender_id: idColumn, recipient_id: idColumn },
          [
            {
              name: "messages_sender_id_fkey",
              columns: ["sender_id"],
              referencedSchema: schema,
              referencedTable: "users",
              referencedColumns: ["id"],
            },
            {
              name: "messages_recipient_id_fkey",
              columns: ["recipient_id"],
              referencedSchema: schema,
              referencedTable: "users",
              referencedColumns: ["id"],
            },
          ],
          { columns: ["id"] },
        ),
      });

      const db = new Database(sharedPool);
      const sender = await db.run(messages.find(100).sender);
      const recipient = await db.run(messages.find(100).recipient);
      expect(sender).toEqual({ id: 1, email: "sender@example.com" });
      expect(recipient).toEqual({ id: 2, email: "recipient@example.com" });
    });
  });

  it("nullable belongs-to returns null when the FK column is NULL", async () => {
    await withTestSchema("tenon_nullable_belongs_to", async (schema) => {
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
             id integer PRIMARY KEY,
             author_id integer REFERENCES "${schema}"."users"(id),
             body text NOT NULL
           )`,
        );
        await client.query(
          `INSERT INTO "${schema}"."posts" (id, author_id, body) VALUES
             (10, NULL, 'no author')`,
        );
      } finally {
        client.release();
      }

      const { posts } = defineSchema({
        users: defineTable(
          schema,
          "users",
          { id: idColumn, email: textColumn },
          [],
          { columns: ["id"] },
        ),
        posts: defineTable(
          schema,
          "posts",
          { id: idColumn, author_id: nullableIdColumn, body: textColumn },
          [
            {
              name: "posts_author_id_fkey",
              columns: ["author_id"],
              referencedSchema: schema,
              referencedTable: "users",
              referencedColumns: ["id"],
            },
          ],
          { columns: ["id"] },
        ),
      });

      const db = new Database(sharedPool);
      // The inner join filters out the NULL FK row, so no users row
      // matches and `db.run` resolves to null — exactly what the
      // SingleRow nullable-by-default contract promises. Nullability
      // surfaces through "no row found" rather than a special path.
      const author = await db.run(posts.find(10).author);
      expect(author).toBeNull();
    });
  });

  it("self-referential FK exposes a belongs-to accessor on the parent column", async () => {
    // employees.manager_id references employees.id. The has-many side
    // would collide with the table's own physical name (employees on
    // employees) and is intentionally skipped; the belongs-to accessor
    // (`manager`, derived from the FK column) works fine.
    await withTestSchema("tenon_self_fk", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."employees" (
             id integer PRIMARY KEY,
             manager_id integer REFERENCES "${schema}"."employees"(id),
             name text NOT NULL
           )`,
        );
        await client.query(
          `INSERT INTO "${schema}"."employees" (id, manager_id, name) VALUES
             (1, NULL, 'Alice'),
             (2, 1, 'Bob')`,
        );
      } finally {
        client.release();
      }

      const { employees } = defineSchema({
        employees: defineTable(
          schema,
          "employees",
          { id: idColumn, manager_id: nullableIdColumn, name: textColumn },
          [
            {
              name: "employees_manager_id_fkey",
              columns: ["manager_id"],
              referencedSchema: schema,
              referencedTable: "employees",
              referencedColumns: ["id"],
            },
          ],
          { columns: ["id"] },
        ),
      });

      const db = new Database(sharedPool);
      const bobsManager = await db.run(employees.find(2).manager);
      expect(bobsManager).toEqual({
        id: 1,
        manager_id: null,
        name: "Alice",
      });
      // Top-of-tree employee has no manager — null FK.
      const alicesManager = await db.run(employees.find(1).manager);
      expect(alicesManager).toBeNull();
    });
  });
});
