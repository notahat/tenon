// End-to-end smoke test for UPDATE. Spins up a `users` table and runs
// Database.run against real Updates: predicate-narrowed, chained
// .where, with RETURNING, null assignments to nullable columns,
// aliased targets, the find(id) shorthand, and the empty-attrs guard.

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
  name: columnType<string, "text">({
    nullable: true,
    hasDefault: false,
    isGenerated: false,
  }),
  active: columnType<boolean, "bool">({
    nullable: false,
    hasDefault: true,
    isGenerated: false,
  }),
};

/** Create the `users` table with a single-column PK and seed three rows. */
async function seedUsers(schema: string) {
  const client = await sharedPool.connect();
  try {
    await client.query(
      `CREATE TABLE "${schema}"."users" (
         id serial PRIMARY KEY,
         email text NOT NULL,
         name text,
         active boolean NOT NULL DEFAULT true
       )`,
    );
    await client.query(
      `INSERT INTO "${schema}"."users" (email, name, active) VALUES
         ('a@example.com', 'Alice', true),
         ('b@example.com', 'Bob', false),
         ('c@example.com', 'Cara', true)`,
    );
  } finally {
    client.release();
  }
  return defineTable(schema, "users", userColumns, [], { columns: ["id"] });
}

describe("Database.run for UPDATE", () => {
  it("resolves to { rowCount } when no RETURNING clause is set", async () => {
    await withTestSchema("tenon_update", async (schema) => {
      const users = await seedUsers(schema);
      const database = new Database(sharedPool);

      const result = await database.run(
        users.where(users.email.eq("a@example.com")).update({ name: "Pete" }),
      );

      expectTypeOf(result).toEqualTypeOf<{ readonly rowCount: number }>();
      expect(result).toEqual({ rowCount: 1 });

      const updated = await database.run(
        users.where(users.email.eq("a@example.com")),
      );
      expect(updated[0]?.name).toBe("Pete");
    });
  });

  it("ANDs chained .where calls and only updates matching rows", async () => {
    await withTestSchema("tenon_update", async (schema) => {
      const users = await seedUsers(schema);
      const database = new Database(sharedPool);

      const result = await database.run(
        users
          .where(users.active.eq(true))
          .where(users.email.eq("c@example.com"))
          .update({ name: "Updated" }),
      );

      expect(result).toEqual({ rowCount: 1 });

      const rows = await database.run(users);
      const named = Object.fromEntries(
        rows.map((row) => [row.email, row.name]),
      );
      expect(named["a@example.com"]).toBe("Alice");
      expect(named["b@example.com"]).toBe("Bob");
      expect(named["c@example.com"]).toBe("Updated");
    });
  });

  it("resolves to typed rows with .returning(...) reflecting the new values", async () => {
    await withTestSchema("tenon_update", async (schema) => {
      const users = await seedUsers(schema);
      const database = new Database(sharedPool);

      const updated = await database.run(
        users
          .where(users.email.eq("b@example.com"))
          .update({ name: "Bob 2", active: true })
          .returning(users.id, users.name, users.active),
      );

      expectTypeOf(updated).toEqualTypeOf<
        { id: number; name: string | null; active: boolean }[]
      >();
      expect(updated).toHaveLength(1);
      expect(updated[0]?.name).toBe("Bob 2");
      expect(updated[0]?.active).toBe(true);
    });
  });

  it("persists null when assigning null to a nullable column", async () => {
    await withTestSchema("tenon_update", async (schema) => {
      const users = await seedUsers(schema);
      const database = new Database(sharedPool);

      await database.run(
        users.where(users.email.eq("a@example.com")).update({ name: null }),
      );

      const row = await database
        .run(users.where(users.email.eq("a@example.com")))
        .then((rows) => rows[0]);
      expect(row?.name).toBeNull();
    });
  });

  it("preserves the alias on the target so UPDATE ... AS works", async () => {
    await withTestSchema("tenon_update", async (schema) => {
      const users = await seedUsers(schema);
      const aliased = users.as("u");
      const database = new Database(sharedPool);

      const result = await database.run(
        aliased
          .where(aliased.email.eq("a@example.com"))
          .update({ name: "via alias" }),
      );

      expect(result).toEqual({ rowCount: 1 });

      const row = await database
        .run(users.where(users.email.eq("a@example.com")))
        .then((rows) => rows[0]);
      expect(row?.name).toBe("via alias");
    });
  });

  it("find(id).update(attrs) updates the matching row", async () => {
    await withTestSchema("tenon_update", async (schema) => {
      const users = await seedUsers(schema);
      const database = new Database(sharedPool);

      const seeded = await database.run(users);
      const target = seeded.find((row) => row.email === "a@example.com");
      expect(target).toBeDefined();

      const result = await database.run(
        users.find(target!.id).update({ name: "found" }),
      );
      expect(result).toEqual({ rowCount: 1 });

      const row = await database
        .run(users.find(target!.id))
        .then((value) => value);
      expect(row?.name).toBe("found");
    });
  });

  it("find(id).update returns rowCount: 0 when the id is missing", async () => {
    await withTestSchema("tenon_update", async (schema) => {
      const users = await seedUsers(schema);
      const database = new Database(sharedPool);

      const result = await database.run(
        users.find(999_999).update({ name: "ghost" }),
      );

      expect(result).toEqual({ rowCount: 0 });
    });
  });

  it("update({}) throws before any SQL is sent", async () => {
    await withTestSchema("tenon_update", async (schema) => {
      const users = await seedUsers(schema);
      const database = new Database(sharedPool);

      await expect(
        database.run(users.where(users.id.eq(1)).update({})),
      ).rejects.toThrow(/SET assignments/);

      const rows = await database.run(users);
      expect(rows.map((row) => row.name).sort()).toEqual([
        "Alice",
        "Bob",
        "Cara",
      ]);
    });
  });
});
