/**
 * Reading db-proxy outbox rows.
 *
 * The outbox publishes rows as CloudEvents over NATS, and Go's JSON
 * marshalling means a field can arrive as `module_id` or `ModuleID`
 * depending on which path produced it. Every projection therefore probes
 * both spellings, which is why these three helpers existed -- copied
 * verbatim into five handler modules, `asString` into six.
 *
 * They live here now. The duplication was harmless until it was not: the
 * copies had already begun to drift, with one module decoding its payload
 * by hand rather than through `msg.json()`.
 */

/** A field value as a string, or "" when it is absent or not a string. */
export const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The first of `values` that is a non-empty string.
 *
 * Used for two different things, both legitimately: choosing between
 * spellings of one field (`row.module_id` vs `row.ModuleID`), and falling
 * back from the CloudEvent envelope to the row body.
 */
export function pickFirst(...values: unknown[]): string {
  for (const value of values) {
    const s = asString(value);
    if (s !== "") {
      return s;
    }
  }
  return "";
}

/**
 * The row carried by a CloudEvent.
 *
 * Some producers nest the row under `data`; others publish it flat. Callers
 * supply the shape they expect, which is a claim about the producer rather
 * than something checked here -- these payloads cross a process boundary and
 * the parsers validate what they need.
 */
export function readRow<T>(ce: Record<string, unknown>): T {
  const data = ce.data;
  if (data && typeof data === "object") {
    return data as T;
  }
  return ce as unknown as T;
}
