// End-to-end smoke test for INSERT. Spins up a `users` table with a
// serial PK and runs Database.run against real Inserts: with and
// without RETURNING, with omitted defaults, and with nullable columns.

import { afterAll, describe, expect, expectTypeOf, it } from "vitest";

import { Database } from "../../src/executor/Database.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { sharedPool, withTestSchema } from "./setup.js";

afterAll(async () => {
  await sharedPool.end();
});

describe("Database.run for INSERT", () => {
  it("resolves to { rowCount } when no RETURNING clause is set", async () => {
    await withTestSchema("tenon_insert", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id serial PRIMARY KEY,
             email text NOT NULL,
             age integer
           )`,
        );
      } finally {
        client.release();
      }

      const users = defineTable(schema, "users", {
        id: columnType<number, "int4">({
          nullable: false,
          hasDefault: true,
          isGenerated: false,
        }),
        email: columnType<string, "text">({
          nullable: false,
          hasDefault: false,
          isGenerated: false,
        }),
        age: columnType<number, "int4">({
          nullable: true,
          hasDefault: false,
          isGenerated: false,
        }),
      });
      const database = new Database(sharedPool);

      const result = await database.run(
        users.insert({ email: "a@example.com", age: 30 }),
      );

      expectTypeOf(result).toEqualTypeOf<{ readonly rowCount: number }>();
      expect(result).toEqual({ rowCount: 1 });
    });
  });

  it("resolves to typed rows with .returning(...), and assigns the serial PK", async () => {
    await withTestSchema("tenon_insert", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id serial PRIMARY KEY,
             email text NOT NULL
           )`,
        );
      } finally {
        client.release();
      }

      const users = defineTable(schema, "users", {
        id: columnType<number, "int4">({
          nullable: false,
          hasDefault: true,
          isGenerated: false,
        }),
        email: columnType<string, "text">({
          nullable: false,
          hasDefault: false,
          isGenerated: false,
        }),
      });
      const database = new Database(sharedPool);

      const rows = await database.run(
        users
          .insert({ email: "pete@notahat.com" })
          .returning(users.id, users.email),
      );

      expectTypeOf(rows).toEqualTypeOf<{ id: number; email: string }[]>();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.email).toBe("pete@notahat.com");
      // Serial PK is auto-assigned; we don't pin its exact value.
      expect(rows[0]?.id).toBeTypeOf("number");
    });
  });

  it("persists null when a nullable column is set to null", async () => {
    await withTestSchema("tenon_insert", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id serial PRIMARY KEY,
             email text NOT NULL,
             age integer
           )`,
        );
      } finally {
        client.release();
      }

      const users = defineTable(schema, "users", {
        id: columnType<number, "int4">({
          nullable: false,
          hasDefault: true,
          isGenerated: false,
        }),
        email: columnType<string, "text">({
          nullable: false,
          hasDefault: false,
          isGenerated: false,
        }),
        age: columnType<number, "int4">({
          nullable: true,
          hasDefault: false,
          isGenerated: false,
        }),
      });
      const database = new Database(sharedPool);

      const rows = await database.run(
        users
          .insert({ email: "a@example.com", age: null })
          .returning(users.age),
      );

      expectTypeOf(rows).toEqualTypeOf<{ age: number | null }[]>();
      expect(rows).toEqual([{ age: null }]);
    });
  });

  it("emits AS in RETURNING when a column is renamed", async () => {
    await withTestSchema("tenon_insert", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id serial PRIMARY KEY,
             email text NOT NULL
           )`,
        );
      } finally {
        client.release();
      }

      const users = defineTable(schema, "users", {
        id: columnType<number, "int4">({
          nullable: false,
          hasDefault: true,
          isGenerated: false,
        }),
        email: columnType<string, "text">({
          nullable: false,
          hasDefault: false,
          isGenerated: false,
        }),
      });
      const database = new Database(sharedPool);

      const rows = await database.run(
        users
          .insert({ email: "a@example.com" })
          .returning(users.id.as("userId"), users.email),
      );

      expectTypeOf(rows).toEqualTypeOf<{ userId: number; email: string }[]>();
      expect(rows[0]?.email).toBe("a@example.com");
      expect(rows[0]?.userId).toBeTypeOf("number");
    });
  });
});
