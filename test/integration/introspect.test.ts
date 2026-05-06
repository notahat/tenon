// Drives the introspection generator against a real Postgres: create
// a couple of tables in a fresh schema, run generateSchema, and
// assert the emitted file content matches what the schema declares.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { generateSchema } from "../../src/introspect/generate.js";
import { sharedPool, withTestSchema } from "./setup.js";

const DATABASE_URL = process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) {
  throw new Error("DATABASE_URL must be set for integration tests.");
}

afterAll(async () => {
  await sharedPool.end();
});

describe("generateSchema", () => {
  it("emits defineTable blocks for every table in the requested schema", async () => {
    await withTestSchema("tenon_introspect", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id integer NOT NULL,
             email text NOT NULL,
             age integer,
             created_at timestamptz NOT NULL
           )`,
        );
        await client.query(
          `CREATE TABLE "${schema}"."posts" (
             id integer NOT NULL,
             author_id integer NOT NULL,
             body text
           )`,
        );
      } finally {
        client.release();
      }

      const tempDir = await mkdtemp(join(tmpdir(), "tenon-test-"));
      const outputPath = join(tempDir, "schema.ts");
      try {
        await generateSchema({
          databaseUrl: DATABASE_URL,
          schemas: [schema],
          outputPath,
        });
        const file = await readFile(outputPath, "utf8");

        expect(file).toContain(
          `import { columnType, defineTable } from "@notahat/tenon/schema-runtime";`,
        );
        expect(file).toContain(
          `export const users = defineTable("${schema}", "users", {`,
        );
        expect(file).toContain(
          `"id": columnType<number, "int4">({ nullable: false }),`,
        );
        expect(file).toContain(
          `"email": columnType<string, "text">({ nullable: false }),`,
        );
        expect(file).toContain(
          `"age": columnType<number, "int4">({ nullable: true }),`,
        );
        expect(file).toContain(
          `"created_at": columnType<Date, "timestamptz">({ nullable: false }),`,
        );
        expect(file).toContain(
          `export const posts = defineTable("${schema}", "posts", {`,
        );
        expect(file).toContain(
          `"author_id": columnType<number, "int4">({ nullable: false }),`,
        );
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
