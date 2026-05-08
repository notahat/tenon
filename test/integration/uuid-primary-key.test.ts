// End-to-end smoke test for UUID primary keys against PG18+, where
// `uuidv7()` is a core builtin. Verifies the two supported insert
// shapes — DB-generated default and client-supplied override — plus
// PK lookup and the v1.14 throwing-find contract.
//
// The whole suite is skipped on older Postgres; tenon supports UUID
// PKs there too, but illustrating the pattern requires PG18's
// builtin generator.

import { v7 as uuidv7 } from "uuid";
import { afterAll, describe, expect, it } from "vitest";

import { Database } from "../../src/executor/Database.js";
import { RowNotFoundError } from "../../src/query/SingleRow.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { sharedPool, withTestSchema } from "./setup.js";

afterAll(async () => {
  await sharedPool.end();
});

// Read the server version once at module load so we can gate the
// suite. `server_version_num` is an integer of the form
// MMmmpp (major * 10000 + minor * 100 + patch); >= 180000 is PG18+.
const versionResult = await sharedPool.query<{ server_version_num: string }>(
  "SHOW server_version_num",
);
const serverVersionNum = Number(versionResult.rows[0]?.server_version_num ?? 0);
const isPg18OrLater = serverVersionNum >= 180000;

// Test helper: build a `users` table with a UUID PK whose default is
// `uuidv7()`. Returns the live tenon Table so each test only declares
// what it needs to assert.
async function withUsersTable<T>(
  body: (
    schema: string,
    users: ReturnType<typeof defineUsersTable>,
  ) => Promise<T>,
): Promise<T> {
  return withTestSchema("tenon_uuid_pk", async (schema) => {
    const client = await sharedPool.connect();
    try {
      await client.query(
        `CREATE TABLE "${schema}"."users" (
           id uuid PRIMARY KEY DEFAULT uuidv7(),
           email text NOT NULL
         )`,
      );
    } finally {
      client.release();
    }
    return body(schema, defineUsersTable(schema));
  });
}

// Test helper: defineTable for the users fixture. Pulled out so the
// PK column flags are declared once.
function defineUsersTable(schema: string) {
  return defineTable(
    schema,
    "users",
    {
      id: columnType<string, "uuid">({
        nullable: false,
        hasDefault: true,
        isGenerated: false,
      }),
      email: columnType<string, "text">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
    },
    [],
    { columns: ["id"] },
  );
}

describe.skipIf(!isPg18OrLater)("UUID primary keys (PG18+)", () => {
  it("server-side default fills in a v7 UUID when id is omitted", async () => {
    await withUsersTable(async (_schema, users) => {
      const database = new Database(sharedPool);

      const rows = await database.run(
        users
          .insert({ email: "pete@notahat.com" })
          .returning(users.id, users.email),
      );

      expect(rows).toHaveLength(1);
      const id = rows[0]?.id ?? "";
      // RFC 9562 v7: position 14 (0-indexed) of the canonical form
      // holds the version nibble.
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  it("client-supplied id overrides the server default", async () => {
    await withUsersTable(async (_schema, users) => {
      const database = new Database(sharedPool);
      const clientId = uuidv7();

      await database.run(
        users.insert({ id: clientId, email: "alice@example.com" }),
      );

      const found = await database.run(users.find(clientId));
      expect(found).toEqual({ id: clientId, email: "alice@example.com" });
    });
  });

  it("find rejects with RowNotFoundError for an unknown UUID", async () => {
    await withUsersTable(async (_schema, users) => {
      const database = new Database(sharedPool);

      await expect(database.run(users.find(uuidv7()))).rejects.toBeInstanceOf(
        RowNotFoundError,
      );
    });
  });
});
