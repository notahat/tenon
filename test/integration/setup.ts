// Integration-test setup shared by every test in this folder.
//
// Connects to the Postgres pointed to by DATABASE_URL, creates a
// dedicated schema for the test run, and tears it down at the end.
// Each test file uses `withTestSchema` to scope its fixtures.
//
// Out of scope: production connection management; transaction
// management beyond what the test driver needs.

import pg from "pg";

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) {
  throw new Error(
    "Integration tests require DATABASE_URL to point at a Postgres instance.",
  );
}

/** A pool shared across the test suite; tests should not pool.end() it. */
export const sharedPool = new pg.Pool({ connectionString: DATABASE_URL });

/** Generate a unique schema name so concurrent runs do not collide. */
export function uniqueSchemaName(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${random}`;
}

/**
 * Create a test schema, run `body` with its name, then drop it. The
 * schema is dropped CASCADE so test fixtures don't need explicit
 * teardown.
 */
export async function withTestSchema<T>(
  prefix: string,
  body: (schemaName: string) => Promise<T>,
): Promise<T> {
  const schema = uniqueSchemaName(prefix);
  const client = await sharedPool.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    client.release();
  }
  try {
    return await body(schema);
  } finally {
    const cleanup = await sharedPool.connect();
    try {
      await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      cleanup.release();
    }
  }
}
