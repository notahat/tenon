// End-to-end smoke test for DELETE. Spins up a `users` table and
// runs Database.run against real Deletes: predicate-narrowed,
// chained .where, with RETURNING, the deleteAll() escape hatch, and
// the empty-WHERE guard on bare `Table.delete()`.

import { afterAll, describe, expect, expectTypeOf, it } from "vitest";

import { Database } from "../../src/executor/Database.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { sharedPool, withTestSchema } from "./setup.js";

afterAll(async () => {
  await sharedPool.end();
});

/** Schema for the users fixture used across these tests. */
const userColumns = {
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
  active: columnType<boolean, "bool">({
    nullable: false,
    hasDefault: true,
    isGenerated: false,
  }),
};

/** Create the `users` table and seed three rows; returns the Table value. */
async function seedUsers(schema: string) {
  const client = await sharedPool.connect();
  try {
    await client.query(
      `CREATE TABLE "${schema}"."users" (
         id serial PRIMARY KEY,
         email text NOT NULL,
         active boolean NOT NULL DEFAULT true
       )`,
    );
    await client.query(
      `INSERT INTO "${schema}"."users" (email, active) VALUES
         ('a@example.com', true),
         ('b@example.com', false),
         ('c@example.com', true)`,
    );
  } finally {
    client.release();
  }
  return defineTable(schema, "users", userColumns);
}

describe("Database.run for DELETE", () => {
  it("resolves to { rowCount } when no RETURNING clause is set", async () => {
    await withTestSchema("tenon_delete", async (schema) => {
      const users = await seedUsers(schema);
      const database = new Database(sharedPool);

      const result = await database.run(
        users.where(users.email.eq("a@example.com")).delete(),
      );

      expectTypeOf(result).toEqualTypeOf<{ readonly rowCount: number }>();
      expect(result).toEqual({ rowCount: 1 });
    });
  });

  it("ANDs chained .where calls and only deletes matching rows", async () => {
    await withTestSchema("tenon_delete", async (schema) => {
      const users = await seedUsers(schema);
      const database = new Database(sharedPool);

      const result = await database.run(
        users
          .where(users.active.eq(true))
          .where(users.email.eq("c@example.com"))
          .delete(),
      );

      expect(result).toEqual({ rowCount: 1 });

      const remaining = await database.run(users);
      expect(remaining.map((row) => row.email).sort()).toEqual([
        "a@example.com",
        "b@example.com",
      ]);
    });
  });

  it("resolves to typed rows with .returning(...) and removes them from the table", async () => {
    await withTestSchema("tenon_delete", async (schema) => {
      const users = await seedUsers(schema);
      const database = new Database(sharedPool);

      const removed = await database.run(
        users
          .where(users.email.eq("b@example.com"))
          .delete()
          .returning(users.id, users.email),
      );

      expectTypeOf(removed).toEqualTypeOf<{ id: number; email: string }[]>();
      expect(removed).toHaveLength(1);
      expect(removed[0]?.email).toBe("b@example.com");
      expect(removed[0]?.id).toBeTypeOf("number");

      const remaining = await database.run(users);
      expect(remaining.map((row) => row.email).sort()).toEqual([
        "a@example.com",
        "c@example.com",
      ]);
    });
  });

  it("Table.deleteAll() clears every row", async () => {
    await withTestSchema("tenon_delete", async (schema) => {
      const users = await seedUsers(schema);
      const database = new Database(sharedPool);

      const result = await database.run(users.deleteAll());

      expect(result).toEqual({ rowCount: 3 });

      const remaining = await database.run(users);
      expect(remaining).toEqual([]);
    });
  });

  it("Table.delete() throws before any SQL is sent", async () => {
    await withTestSchema("tenon_delete", async (schema) => {
      const users = await seedUsers(schema);
      const database = new Database(sharedPool);

      await expect(database.run(users.delete())).rejects.toThrow(/deleteAll/);

      const remaining = await database.run(users);
      expect(remaining).toHaveLength(3);
    });
  });

  it("preserves the alias on the target so DELETE FROM ... AS works", async () => {
    await withTestSchema("tenon_delete", async (schema) => {
      const users = await seedUsers(schema);
      const aliased = users.as("u");
      const database = new Database(sharedPool);

      const result = await database.run(
        aliased.where(aliased.email.eq("a@example.com")).delete(),
      );

      expect(result).toEqual({ rowCount: 1 });
    });
  });
});
