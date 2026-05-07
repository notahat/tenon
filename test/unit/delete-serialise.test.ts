import { describe, expect, it } from "vitest";

import { deleteNode } from "../../src/ast/delete.js";
import { binaryOp, columnRef, parameter } from "../../src/ast/expression.js";
import { projectionItem, tableRef } from "../../src/ast/relation.js";
import { deleteToSql } from "../../src/sql/serialise.js";

describe("deleteToSql", () => {
  it("emits DELETE FROM ... WHERE ... with one predicate", () => {
    const compiled = deleteToSql(
      deleteNode({
        target: tableRef({ schema: "public", name: "users" }),
        predicates: [
          binaryOp(
            "=",
            columnRef({ tableAlias: "users", column: "id" }),
            parameter(42),
          ),
        ],
      }),
    );

    expect(compiled).toEqual({
      text: `DELETE FROM "public"."users" WHERE ("users"."id" = $1)`,
      params: [42],
    });
  });

  it("AND-s multiple predicates in source order with sequential parameters", () => {
    const compiled = deleteToSql(
      deleteNode({
        target: tableRef({ schema: "public", name: "users" }),
        predicates: [
          binaryOp(
            "=",
            columnRef({ tableAlias: "users", column: "email" }),
            parameter("pete@notahat.com"),
          ),
          binaryOp(
            "=",
            columnRef({ tableAlias: "users", column: "active" }),
            parameter(true),
          ),
        ],
      }),
    );

    expect(compiled).toEqual({
      text:
        `DELETE FROM "public"."users" WHERE ` +
        `("users"."email" = $1) AND ("users"."active" = $2)`,
      params: ["pete@notahat.com", true],
    });
  });

  it("quotes schema, table, and column identifiers", () => {
    const compiled = deleteToSql(
      deleteNode({
        target: tableRef({ schema: "App", name: `weird"name` }),
        predicates: [
          binaryOp(
            "=",
            columnRef({ tableAlias: `weird"name`, column: `odd"col` }),
            parameter(1),
          ),
        ],
      }),
    );

    expect(compiled.text).toBe(
      `DELETE FROM "App"."weird""name" WHERE ("weird""name"."odd""col" = $1)`,
    );
  });

  it("preserves the alias on the target TableRef so qualified column refs still resolve", () => {
    const compiled = deleteToSql(
      deleteNode({
        target: tableRef({ schema: "public", name: "users", alias: "u" }),
        predicates: [
          binaryOp(
            "=",
            columnRef({ tableAlias: "u", column: "id" }),
            parameter(1),
          ),
        ],
      }),
    );

    expect(compiled.text).toBe(
      `DELETE FROM "public"."users" AS "u" WHERE ("u"."id" = $1)`,
    );
  });

  it("appends RETURNING with bare columns when they keep their name", () => {
    const compiled = deleteToSql(
      deleteNode({
        target: tableRef({ schema: "public", name: "users" }),
        predicates: [
          binaryOp(
            "=",
            columnRef({ tableAlias: "users", column: "id" }),
            parameter(1),
          ),
        ],
        returning: [
          projectionItem(
            columnRef({ tableAlias: "users", column: "id" }),
            "id",
          ),
          projectionItem(
            columnRef({ tableAlias: "users", column: "email" }),
            "email",
          ),
        ],
      }),
    );

    expect(compiled.text).toBe(
      `DELETE FROM "public"."users" WHERE ("users"."id" = $1) ` +
        `RETURNING "users"."id", "users"."email"`,
    );
    expect(compiled.params).toEqual([1]);
  });

  it("emits AS when a returning item is renamed", () => {
    const compiled = deleteToSql(
      deleteNode({
        target: tableRef({ schema: "public", name: "users" }),
        predicates: [
          binaryOp(
            "=",
            columnRef({ tableAlias: "users", column: "id" }),
            parameter(1),
          ),
        ],
        returning: [
          projectionItem(
            columnRef({ tableAlias: "users", column: "id" }),
            "userId",
          ),
        ],
      }),
    );

    expect(compiled.text).toBe(
      `DELETE FROM "public"."users" WHERE ("users"."id" = $1) ` +
        `RETURNING "users"."id" AS "userId"`,
    );
  });

  it("emits a bare DELETE FROM when allowEmptyPredicates is true", () => {
    const compiled = deleteToSql(
      deleteNode({
        target: tableRef({ schema: "public", name: "users" }),
        allowEmptyPredicates: true,
      }),
    );

    expect(compiled).toEqual({
      text: `DELETE FROM "public"."users"`,
      params: [],
    });
  });

  it("supports allowEmptyPredicates + RETURNING together", () => {
    const compiled = deleteToSql(
      deleteNode({
        target: tableRef({ schema: "public", name: "users" }),
        allowEmptyPredicates: true,
        returning: [
          projectionItem(
            columnRef({ tableAlias: "users", column: "id" }),
            "id",
          ),
        ],
      }),
    );

    expect(compiled.text).toBe(
      `DELETE FROM "public"."users" RETURNING "users"."id"`,
    );
  });

  it("throws when the predicate list is empty and allowEmptyPredicates is off", () => {
    expect(() =>
      deleteToSql(
        deleteNode({
          target: tableRef({ schema: "public", name: "users" }),
        }),
      ),
    ).toThrow(/deleteAll/);
  });
});
