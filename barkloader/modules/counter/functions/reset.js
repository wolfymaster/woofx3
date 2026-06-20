// counter:function:reset
//
// Resets the chosen counter to a specified initial value (defaults to 0).
// Useful for "start of stream" resets or clearing a goal counter.
//
// Parameters (from ctx.event.parameters):
//   - target        (string)  canonical counter id — required
//   - initialValue  (number)  value to reset to; defaults to 0
//
// Storage key: `state:<canonical_id>`.
function reset(ctx) {
  const params = (ctx.event && ctx.event.parameters) || ctx.event || {};
  const target = String(params.target || "").trim();
  if (!target) {
    throw new Error("reset: `target` parameter is required (canonical id of the counter)");
  }
  const raw = params.initialValue;
  const initialValue = Number.isFinite(Number(raw)) ? Number(raw) : 0;
  const key = "state:" + target;
  const previous = Number(ctx.storage.get(key)) || 0;
  ctx.storage.set(key, initialValue);
  return { target, previous, next: initialValue, initialValue };
}
