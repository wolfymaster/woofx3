// ot-json0 ships no types. The slice the scene document uses.
declare module "ot-json0" {
  interface Json0Type {
    /** Applies `op` to `snapshot` in place and returns it. */
    apply(snapshot: unknown, op: unknown[]): unknown;
    /** `op` rewritten to apply after `otherOp`; `side` breaks ties. */
    transform(op: unknown[], otherOp: unknown[], side: "left" | "right"): unknown[];
    compose(op1: unknown[], op2: unknown[]): unknown[];
    invert(op: unknown[]): unknown[];
  }
  const json0: { type: Json0Type };
  export default json0;
}
