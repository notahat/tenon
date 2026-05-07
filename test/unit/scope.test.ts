import { describe, expect, it } from "vitest";

import { Relation } from "../../src/query/Relation.js";
import { scope } from "../../src/query/scope.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";

const users = defineTable("public", "users", {
  id: columnType<number, "int4">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
  email: columnType<string, "text">({
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

describe("scope", () => {
  it("returns a transform that applies the body to its argument", () => {
    const active = scope(users, (relation) =>
      relation.where(users.active.eq(true)),
    );

    const filtered = active(users);

    expect(filtered).toBeInstanceOf(Relation);
    expect(filtered.node.kind).toBe("Where");
  });

  it("composes with other scopes by ordinary function application", () => {
    const active = scope(users, (relation) =>
      relation.where(users.active.eq(true)),
    );
    const byEmail = scope(users, (relation) =>
      relation.order(users.email.asc()),
    );

    const composed = byEmail(active(users));

    expect(composed.node.kind).toBe("Order");
  });
});
