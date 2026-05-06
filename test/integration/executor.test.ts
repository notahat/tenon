// End-to-end smoke test for the executor: spin up a tiny `users`
// table in a fresh schema, run a few typed queries, assert both
// runtime values and (where useful) static row shapes.

import { afterAll, describe, expect, expectTypeOf, it } from "vitest";

import { Database } from "../../src/executor/Database.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { sharedPool, withTestSchema } from "./setup.js";

afterAll(async () => {
  await sharedPool.end();
});

describe("Database.run end-to-end", () => {
  it("returns all rows with full-column row types when no project is used", async () => {
    await withTestSchema("tenon_executor", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id integer NOT NULL,
             email text NOT NULL,
             age integer
           )`,
        );
        await client.query(
          `INSERT INTO "${schema}"."users" (id, email, age) VALUES
             (1, 'a@example.com', 30),
             (2, 'b@example.com', NULL)`,
        );
      } finally {
        client.release();
      }

      const users = defineTable(schema, "users", {
        id: columnType<number, "int4">({ nullable: false }),
        email: columnType<string, "text">({ nullable: false }),
        age: columnType<number, "int4">({ nullable: true }),
      });
      const db = new Database(sharedPool);

      const rows = await db.run(users.order(users.id.asc()));

      expectTypeOf(rows).toEqualTypeOf<
        { id: number; email: string; age: number | null }[]
      >();
      expect(rows).toEqual([
        { id: 1, email: "a@example.com", age: 30 },
        { id: 2, email: "b@example.com", age: null },
      ]);
    });
  });

  it("filters with where and emits parameters in order", async () => {
    await withTestSchema("tenon_executor", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id integer NOT NULL,
             email text NOT NULL
           )`,
        );
        await client.query(
          `INSERT INTO "${schema}"."users" (id, email) VALUES
             (1, 'a@example.com'),
             (2, 'b@example.com'),
             (3, 'c@example.com')`,
        );
      } finally {
        client.release();
      }

      const users = defineTable(schema, "users", {
        id: columnType<number, "int4">({ nullable: false }),
        email: columnType<string, "text">({ nullable: false }),
      });
      const db = new Database(sharedPool);

      const rows = await db.run(users.where(users.id.in([1, 3])));
      expect(rows.map((row) => row.id).sort()).toEqual([1, 3]);
    });
  });

  it("narrows the row shape when project is used", async () => {
    await withTestSchema("tenon_executor", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id integer NOT NULL,
             email text NOT NULL,
             age integer
           )`,
        );
        await client.query(
          `INSERT INTO "${schema}"."users" (id, email, age) VALUES
             (1, 'only@example.com', 42)`,
        );
      } finally {
        client.release();
      }

      const users = defineTable(schema, "users", {
        id: columnType<number, "int4">({ nullable: false }),
        email: columnType<string, "text">({ nullable: false }),
        age: columnType<number, "int4">({ nullable: true }),
      });
      const db = new Database(sharedPool);

      const rows = await db.run(
        users.project(users.id.as("userId"), users.email),
      );

      expectTypeOf(rows).toEqualTypeOf<{ userId: number; email: string }[]>();
      expect(rows).toEqual([{ userId: 1, email: "only@example.com" }]);
    });
  });
});
