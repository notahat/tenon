import { describe, expect, it } from "vitest";

import { binaryOp, columnRef, parameter } from "../../src/ast/expression.js";
import { projectionItem, tableRef } from "../../src/ast/relation.js";
import { updateAssignment, updateNode } from "../../src/ast/update.js";
import { updateToSql } from "../../src/sql/serialise.js";

describe("updateToSql", () => {
  it("emits UPDATE ... SET ... WHERE ... with one assignment and one predicate", () => {
    const compiled = updateToSql(
      updateNode({
        target: tableRef({ schema: "public", name: "users" }),
        assignments: [updateAssignment("name", parameter("Pete"))],
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
      text:
        `UPDATE "public"."users" SET "name" = $1 ` +
        `WHERE ("users"."id" = $2)`,
      params: ["Pete", 42],
    });
  });

  it("emits assignments in supplied order with sequential parameters before predicates", () => {
    const compiled = updateToSql(
      updateNode({
        target: tableRef({ schema: "public", name: "users" }),
        assignments: [
          updateAssignment("name", parameter("Pete")),
          updateAssignment("active", parameter(false)),
        ],
        predicates: [
          binaryOp(
            "=",
            columnRef({ tableAlias: "users", column: "id" }),
            parameter(1),
          ),
        ],
      }),
    );

    expect(compiled).toEqual({
      text:
        `UPDATE "public"."users" SET "name" = $1, "active" = $2 ` +
        `WHERE ("users"."id" = $3)`,
      params: ["Pete", false, 1],
    });
  });

  it("AND-s multiple predicates in source order", () => {
    const compiled = updateToSql(
      updateNode({
        target: tableRef({ schema: "public", name: "users" }),
        assignments: [updateAssignment("name", parameter("Pete"))],
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

    expect(compiled.text).toBe(
      `UPDATE "public"."users" SET "name" = $1 WHERE ` +
        `("users"."email" = $2) AND ("users"."active" = $3)`,
    );
    expect(compiled.params).toEqual(["Pete", "pete@notahat.com", true]);
  });

  it("quotes schema, table, and column identifiers", () => {
    const compiled = updateToSql(
      updateNode({
        target: tableRef({ schema: "App", name: `weird"name` }),
        assignments: [updateAssignment(`odd"col`, parameter("x"))],
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
      `UPDATE "App"."weird""name" SET "odd""col" = $1 ` +
        `WHERE ("weird""name"."odd""col" = $2)`,
    );
  });

  it("preserves the alias on the target TableRef", () => {
    const compiled = updateToSql(
      updateNode({
        target: tableRef({ schema: "public", name: "users", alias: "u" }),
        assignments: [updateAssignment("name", parameter("Pete"))],
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
      `UPDATE "public"."users" AS "u" SET "name" = $1 ` +
        `WHERE ("u"."id" = $2)`,
    );
  });

  it("appends RETURNING with bare columns when they keep their name", () => {
    const compiled = updateToSql(
      updateNode({
        target: tableRef({ schema: "public", name: "users" }),
        assignments: [updateAssignment("name", parameter("Pete"))],
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
      `UPDATE "public"."users" SET "name" = $1 ` +
        `WHERE ("users"."id" = $2) ` +
        `RETURNING "users"."id", "users"."email"`,
    );
    expect(compiled.params).toEqual(["Pete", 1]);
  });

  it("emits AS when a returning item is renamed", () => {
    const compiled = updateToSql(
      updateNode({
        target: tableRef({ schema: "public", name: "users" }),
        assignments: [updateAssignment("name", parameter("Pete"))],
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
      `UPDATE "public"."users" SET "name" = $1 ` +
        `WHERE ("users"."id" = $2) ` +
        `RETURNING "users"."id" AS "userId"`,
    );
  });

  it("throws when the assignment list is empty", () => {
    expect(() =>
      updateToSql(
        updateNode({
          target: tableRef({ schema: "public", name: "users" }),
          assignments: [],
          predicates: [
            binaryOp(
              "=",
              columnRef({ tableAlias: "users", column: "id" }),
              parameter(1),
            ),
          ],
        }),
      ),
    ).toThrow(/update/);
  });

  it("throws when the predicate list is empty", () => {
    expect(() =>
      updateToSql(
        updateNode({
          target: tableRef({ schema: "public", name: "users" }),
          assignments: [updateAssignment("name", parameter("x"))],
          predicates: [],
        }),
      ),
    ).toThrow(/WHERE/);
  });
});
