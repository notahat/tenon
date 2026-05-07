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
          `"id": columnType<number, "int4">({ nullable: false, hasDefault: false, isGenerated: false }),`,
        );
        expect(file).toContain(
          `"email": columnType<string, "text">({ nullable: false, hasDefault: false, isGenerated: false }),`,
        );
        expect(file).toContain(
          `"age": columnType<number, "int4">({ nullable: true, hasDefault: false, isGenerated: false }),`,
        );
        expect(file).toContain(
          `"created_at": columnType<Date, "timestamptz">({ nullable: false, hasDefault: false, isGenerated: false }),`,
        );
        expect(file).toContain(
          `export const posts = defineTable("${schema}", "posts", {`,
        );
        expect(file).toContain(
          `"author_id": columnType<number, "int4">({ nullable: false, hasDefault: false, isGenerated: false }),`,
        );
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  it("flags identity, default, and generated columns from pg_catalog", async () => {
    await withTestSchema("tenon_introspect_flags", async (schema) => {
      const client = await sharedPool.connect();
      try {
        // Mix every kind of "optional in INSERT" or "forbidden in INSERT"
        // column: serial PK, GENERATED IDENTITY, plain DEFAULT, and a
        // STORED generated expression, alongside plain required columns.
        await client.query(
          `CREATE TABLE "${schema}"."widgets" (
             id serial PRIMARY KEY,
             ident integer GENERATED ALWAYS AS IDENTITY,
             name text NOT NULL,
             label text NOT NULL DEFAULT 'unnamed',
             label_upper text GENERATED ALWAYS AS (upper(label)) STORED
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

        // Serial PK: hasDefault=true (sequence default), not generated.
        expect(file).toContain(
          `"id": columnType<number, "int4">({ nullable: false, hasDefault: true, isGenerated: false }),`,
        );
        // GENERATED ALWAYS AS IDENTITY: hasDefault=true (identity), not
        // an expression-generated column.
        expect(file).toContain(
          `"ident": columnType<number, "int4">({ nullable: false, hasDefault: true, isGenerated: false }),`,
        );
        // Plain required column: both flags false.
        expect(file).toContain(
          `"name": columnType<string, "text">({ nullable: false, hasDefault: false, isGenerated: false }),`,
        );
        // DEFAULT clause: hasDefault=true, not generated.
        expect(file).toContain(
          `"label": columnType<string, "text">({ nullable: false, hasDefault: true, isGenerated: false }),`,
        );
        // GENERATED ALWAYS AS (...) STORED: isGenerated=true. Postgres
        // also reports atthasdef=true for stored generated columns, so
        // hasDefault is true. nullable=true because Postgres marks
        // generated columns non-NOT-NULL unless the user adds NOT NULL.
        expect(file).toContain(
          `"label_upper": columnType<string, "text">({ nullable: true, hasDefault: true, isGenerated: true }),`,
        );
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
