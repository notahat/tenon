// Re-export of JoinBuilder, which is defined alongside Relation in
// `./Relation.ts`. Co-locating the two classes avoids the ESM
// circular import that the `JoinBuilder extends Relation`
// inheritance would otherwise trigger.

export { JoinBuilder } from "./Relation.js";
