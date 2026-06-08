// Type-level tests for Table.insert / Insert.returning / Database.run
// dispatch. `@ts-expect-error` lines document compile errors we rely
// on; if the surrounding code starts compiling, the directive flags
// the regression.

import { expectTypeOf, test } from "vitest";

import type { Database } from "../../src/executor/Database.js";
import { Insert } from "../../src/query/Insert.js";
import type { InsertableAttrs } from "../../src/query/types.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";

declare const database: Database;

// A representative table covering every column shape the type
// machinery has to handle: required, nullable, has-default, and
// generated.
const widgets = defineTable("public", "widgets", {
  id: columnType<number, "int4">({
    nullable: false,
    hasDefault: true,
    isGenerated: false,
  }),
  name: columnType<string, "text">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
  description: columnType<string, "text">({
    nullable: true,
    hasDefault: false,
    isGenerated: false,
  }),
  created_at: columnType<Date, "timestamptz">({
    nullable: false,
    hasDefault: true,
    isGenerated: false,
  }),
  name_upper: columnType<string, "text">({
    nullable: true,
    hasDefault: true,
    isGenerated: true,
  }),
});

type WidgetsColumns = (typeof widgets)["_columns"];

test("InsertableAttrs requires NOT NULL columns without defaults", () => {
  expectTypeOf<InsertableAttrs<WidgetsColumns>>().toMatchObjectType<{
    name: string;
  }>();
});

test("InsertableAttrs makes nullable columns optional and accepting of null", () => {
  expectTypeOf<InsertableAttrs<WidgetsColumns>>().toMatchObjectType<{
    description?: string | null;
  }>();
});

test("InsertableAttrs makes columns with defaults optional", () => {
  expectTypeOf<InsertableAttrs<WidgetsColumns>>().toMatchObjectType<{
    id?: number;
    created_at?: Date;
  }>();
});

test("InsertableAttrs omits generated columns entirely", () => {
  // Supplying a generated column is a "no such property" error.
  // @ts-expect-error name_upper is generated and absent from the attrs type
  widgets.insert({ name: "x", name_upper: "X" });
});

test("missing a required column is a compile error", () => {
  // @ts-expect-error name is required and not provided
  widgets.insert({});
});

test("supplying null to a non-nullable column with a default is a compile error", () => {
  widgets.insert({
    name: "x",
    // @ts-expect-error created_at is non-nullable
    created_at: null,
  });
});

test(".insert returns Insert<Columns, null>", () => {
  const built = widgets.insert({ name: "x" });
  expectTypeOf(built).toExtend<Insert<WidgetsColumns, null>>();
});

test(".returning(...) flips Returning to the projected shape", () => {
  const returning = widgets.insert({ name: "x" }).returning(widgets.id);
  expectTypeOf(returning).toExtend<
    Insert<WidgetsColumns, { readonly id: WidgetsColumns["id"] }>
  >();
});

test("db.run on an Insert without RETURNING resolves to { rowCount }", () => {
  const result = database.run(widgets.insert({ name: "x" }));
  expectTypeOf(result).resolves.toEqualTypeOf<{ readonly rowCount: number }>();
});

test("db.run on an Insert with RETURNING resolves to typed rows", () => {
  const result = database.run(
    widgets.insert({ name: "x" }).returning(widgets.id, widgets.name),
  );
  expectTypeOf(result).resolves.toEqualTypeOf<{ id: number; name: string }[]>();
});

test(".insert is not exposed on a derived Relation", () => {
  // @ts-expect-error .where(...) returns a Relation; .insert is not there
  widgets.where(widgets.name.eq("x")).insert({ name: "y" });
});
