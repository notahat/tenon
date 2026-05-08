// Type-level tests for the primary-key metadata threading through
// defineTable and Table.as. The `_primaryKey` phantom carries the
// declared columns tuple verbatim; `Table.find(id)` (added in step 2
// of the v1.11 plan) reads it.

import { expectTypeOf, test } from "vitest";

import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";

const users = defineTable("public", "users", {
  id: columnType<number, "int4">({
    nullable: false,
    hasDefault: true,
    isGenerated: false,
  }),
});

test("a table without a primary key carries an empty PK tuple", () => {
  expectTypeOf(users._primaryKey).toEqualTypeOf<{
    readonly columns: readonly [];
  }>();
});

test("a table with a primary key carries the literal column tuple", () => {
  const posts = defineTable(
    "public",
    "posts",
    {
      id: columnType<number, "int4">({
        nullable: false,
        hasDefault: true,
        isGenerated: false,
      }),
    },
    [],
    { columns: ["id"] },
  );
  expectTypeOf(posts._primaryKey).toEqualTypeOf<{
    readonly columns: readonly ["id"];
  }>();
});

test("composite primary keys are preserved as the literal tuple", () => {
  const tenantUsers = defineTable(
    "public",
    "tenant_users",
    {
      tenant_id: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
      user_id: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
    },
    [],
    { columns: ["tenant_id", "user_id"] },
  );
  expectTypeOf(tenantUsers._primaryKey).toEqualTypeOf<{
    readonly columns: readonly ["tenant_id", "user_id"];
  }>();
});

test("Table.as preserves the primary-key tuple unchanged", () => {
  const posts = defineTable(
    "public",
    "posts",
    {
      id: columnType<number, "int4">({
        nullable: false,
        hasDefault: true,
        isGenerated: false,
      }),
    },
    [],
    { columns: ["id"] },
  );
  const aliased = posts.as("p");
  expectTypeOf(aliased._primaryKey).toEqualTypeOf<typeof posts._primaryKey>();
});
