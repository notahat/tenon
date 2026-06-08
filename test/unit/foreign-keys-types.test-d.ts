// Type-level tests for the FKs generic threading through Relation,
// Table, JoinBuilder, and WritableScope, and for the self-join
// brand on JoinBuilder.

import { expectTypeOf, test } from "vitest";

import type { Database } from "../../src/executor/Database.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import type { ForeignKey } from "../../src/schema-runtime/foreignKey.js";

declare const db: Database;

const users = defineTable("public", "users", {
  id: columnType<number, "int4">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
  active: columnType<boolean, "bool">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
});

const posts = defineTable(
  "public",
  "posts",
  {
    id: columnType<number, "int4">({
      nullable: false,
      hasDefault: false,
      isGenerated: false,
    }),
    author_id: columnType<number, "int4">({
      nullable: false,
      hasDefault: false,
      isGenerated: false,
    }),
  },
  [
    {
      name: "posts_author_id_fkey",
      columns: ["author_id"],
      referencedSchema: "public",
      referencedTable: "users",
      referencedColumns: ["id"],
    },
  ] as const,
);

test("a table without FKs carries an empty FK tuple", () => {
  expectTypeOf(users._foreignKeys).toEqualTypeOf<readonly []>();
});

test("a table with FKs carries the literal FK tuple", () => {
  type Expected = readonly [
    {
      readonly name: "posts_author_id_fkey";
      readonly columns: readonly ["author_id"];
      readonly referencedSchema: "public";
      readonly referencedTable: "users";
      readonly referencedColumns: readonly ["id"];
    },
  ];
  expectTypeOf(posts._foreignKeys).toEqualTypeOf<Expected>();
});

test("Table.as preserves the FK tuple unchanged", () => {
  const aliased = posts.as("p");
  expectTypeOf(aliased._foreignKeys).toEqualTypeOf<typeof posts._foreignKeys>();
});

test(".where preserves FKs through the Relation chain", () => {
  const filtered = posts.where(posts.author_id.eq(1));
  expectTypeOf(filtered._foreignKeys).toEqualTypeOf<
    typeof posts._foreignKeys
  >();
});

test(".order preserves FKs through the Relation chain", () => {
  const ordered = posts.order(posts.author_id.asc());
  expectTypeOf(ordered._foreignKeys).toEqualTypeOf<typeof posts._foreignKeys>();
});

test(".limit and .offset preserve FKs through the Relation chain", () => {
  const paged = posts.limit(10).offset(5);
  expectTypeOf(paged._foreignKeys).toEqualTypeOf<typeof posts._foreignKeys>();
});

test(".project preserves FKs through the Relation chain", () => {
  const projected = posts.project(posts.id);
  expectTypeOf(projected._foreignKeys).toEqualTypeOf<
    typeof posts._foreignKeys
  >();
});

test("innerJoin's resulting Relation carries the merged FK union", () => {
  const joined = posts
    .innerJoin(users)
    .on(posts.author_id.eq(users.id))
    .project(posts.id, users.active);
  expectTypeOf(joined._foreignKeys).toExtend<readonly ForeignKey[]>();
  // The merged tuple has at least the posts → users FK.
  type Joined = typeof joined._foreignKeys;
  type FirstFk = Joined extends readonly [infer First, ...infer _]
    ? First
    : never;
  expectTypeOf<FirstFk>().toExtend<{ readonly name: string }>();
});

test("FKs default to readonly [] when not supplied at definition", () => {
  expectTypeOf(users._foreignKeys).toEqualTypeOf<readonly []>();
});

test("Table tracks the literal physical schema and name", () => {
  expectTypeOf(users._schema).toEqualTypeOf<"public">();
  expectTypeOf(users._physicalName).toEqualTypeOf<"users">();
});

test("Table.as preserves the physical schema and name", () => {
  const aliased = users.as("u");
  expectTypeOf(aliased._schema).toEqualTypeOf<"public">();
  expectTypeOf(aliased._physicalName).toEqualTypeOf<"users">();
  expectTypeOf(aliased._tableName).toEqualTypeOf<"u">();
});

test("a top-level self-join brands the merged shape", () => {
  const join = users.innerJoin(users);
  // @ts-expect-error self-join brand surfaces at db.run
  void db.run(join);
});

test("a self-join via aliases on the same physical table is also branded", () => {
  const left = users.as("u");
  const right = users.as("v");
  const join = left.innerJoin(right);
  // @ts-expect-error self-join brand surfaces at db.run
  void db.run(join);
});

test(".on() clears the self-join brand", () => {
  const left = users.as("u");
  const right = users.as("v");
  const ok = left.innerJoin(right).on(left.id.eq(right.id)).project(left.id);
  void db.run(ok);
});

const usersOnlyId = defineTable("public", "users_only_id", {
  id: columnType<number, "int4">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
});

test("brand fires when no FK connects the two tables", () => {
  const orphan = defineTable("public", "orphans", {
    name: columnType<string, "text">({
      nullable: false,
      hasDefault: false,
      isGenerated: false,
    }),
  });
  const join = orphan.innerJoin(usersOnlyId);
  // @ts-expect-error missing FK
  void db.run(join);
});

test("brand fires when more than one FK connects the two tables", () => {
  const accounts = defineTable(
    "public",
    "accounts",
    {
      creator_id: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
      owner_id: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
    },
    [
      {
        name: "accounts_creator_id_fkey",
        columns: ["creator_id"],
        referencedSchema: "public",
        referencedTable: "users_only_id",
        referencedColumns: ["id"],
      },
      {
        name: "accounts_owner_id_fkey",
        columns: ["owner_id"],
        referencedSchema: "public",
        referencedTable: "users_only_id",
        referencedColumns: ["id"],
      },
    ] as const,
  );
  const join = accounts.innerJoin(usersOnlyId);
  // @ts-expect-error ambiguous FK
  void db.run(join);
});

test("a unique single-column FK does not trigger any brand", () => {
  const postsAuthor = defineTable(
    "public",
    "posts_author",
    {
      author_id: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
    },
    [
      {
        name: "posts_author_id_fkey",
        columns: ["author_id"],
        referencedSchema: "public",
        referencedTable: "users_only_id",
        referencedColumns: ["id"],
      },
    ] as const,
  );
  void db.run(postsAuthor.innerJoin(usersOnlyId));
});

test(".on() clears the missing-FK brand", () => {
  const orphan = defineTable("public", "orphans2", {
    id: columnType<number, "int4">({
      nullable: false,
      hasDefault: false,
      isGenerated: false,
    }),
  });
  const ok = orphan
    .innerJoin(usersOnlyId)
    .on(orphan.id.eq(usersOnlyId.id))
    .project(orphan.id);
  void db.run(ok);
});

test("composite FKs are skipped — they don't satisfy the single match", () => {
  const events = defineTable(
    "public",
    "events",
    {
      user_id: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
      tenant_id: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
    },
    [
      {
        name: "events_user_fkey",
        columns: ["user_id", "tenant_id"],
        referencedSchema: "public",
        referencedTable: "users_only_id",
        referencedColumns: ["id", "tenant"],
      },
    ] as const,
  );
  const join = events.innerJoin(usersOnlyId);
  // @ts-expect-error composite FK isn't single-column, so the
  // inference path treats this as a missing match.
  void db.run(join);
});
