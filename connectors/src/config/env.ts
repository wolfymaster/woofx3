/** The trimmed text of a value, or undefined when it is missing or blank. A number is the all-digit string loadRuntimeEnv coerced. */
export function nonBlank(value: string | number | undefined): string | undefined {
  const text = value === undefined ? "" : String(value).trim();
  return text === "" ? undefined : text;
}

/** A zod preprocessor that turns a blank string into undefined so the schema's default or optional applies. */
export function unsetWhenBlank(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}
