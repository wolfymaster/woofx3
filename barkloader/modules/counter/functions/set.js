// counter:function:set
//
// Overwrites the chosen counter's value with an explicit number.
// Returns the target, the previous value, and the new value.
//
// Parameters (from ctx.event.parameters):
//   - target  (string)  canonical counter id (e.g. `counter:counter:death_count`)
//   - value   (number)  the value to set the counter to (required, must be finite)
//
// Storage key: `state:<canonical_id>` (same convention as increment/decrement).
function set(ctx) {
  const params = (ctx.event && ctx.event.parameters) || ctx.event || {};
  const target = String(params.target || "").trim();
  if (!target) {
    throw new Error("set: `target` parameter is required (canonical id of the counter)");
  }
  const raw = params.value;
  if (!Number.isFinite(Number(raw))) {
    throw new Error("set: `value` must be a finite number, got: " + JSON.stringify(raw));
  }
  const value = Number(raw);
  const key = "state:" + target;
  const previous = Number(ctx.storage.get(key)) || 0;
  ctx.storage.set(key, value);
  return { target, previous, next: value };
}
