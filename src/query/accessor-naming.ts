// Naming rules for the FK association accessors that defineSchema
// merges onto SingleRow values. Implemented once here so the runtime
// wiring and the type-level transform agree by construction. Both
// have-many and belongs-to rules live here even though belongs-to
// lands in step 4 of the v1.11 plan; keeping them together documents
// the full convention.
//
// Out of scope: the actual Object.assign of accessors
// (src/schema-runtime/defineSchema.ts); the type-level association
// map (src/query/types.ts).

/**
 * Accessor name for a has-many association. The referencing table's
 * physical name is used verbatim — `comments` joining back to `posts`
 * via `comments.post_id` becomes `posts.<wired>.comments`. No
 * pluralisation logic; whatever the database calls the table is what
 * the accessor is called.
 */
export function hasManyAccessorName(referencingTablePhysicalName: string): string {
  return referencingTablePhysicalName;
}

/**
 * Accessor name for a belongs-to association. The FK column on the
 * referencing table is used, with a trailing `_id` stripped if
 * present (`author_id` → `author`). Columns without an `_id` suffix
 * fall back to the referenced table's physical name verbatim — no
 * singularisation library, no convention beyond `_id`.
 */
export function belongsToAccessorName(
  fkColumn: string,
  referencedTablePhysicalName: string,
): string {
  if (fkColumn.endsWith("_id") && fkColumn.length > "_id".length) {
    return fkColumn.slice(0, -"_id".length);
  }
  return referencedTablePhysicalName;
}
