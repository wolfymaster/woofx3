import { camelToScreamingSnake } from "./config";

/**
 * The shortest secret accepted, in bytes: the 256 bits an HMAC-SHA256 key
 * needs. Must match `MinSecretBytes` in shared/common/golang/config/secret.go
 * and `MIN_SECRET_BYTES` in shared/common/rust/runtime/src/secret.rs.
 */
export const MIN_SECRET_BYTES = 32;

/**
 * Values templates and examples have shipped in place of a secret, compared
 * case-insensitively. Each is public, so a service keyed with one is keyed
 * with a value anyone can read. Must match the Go and Rust lists.
 */
const PLACEHOLDER_SECRETS: ReadonlySet<string> = new Set([
  "change_me",
  "changeme",
  "change-me",
  "secret",
  "password",
  "placeholder",
  "todo",
  "xxx",
  "test",
]);

/**
 * Unicode White_Space, the set Go's strings.TrimSpace and Rust's str::trim
 * strip. String.prototype.trim differs: it also strips U+FEFF (a byte order
 * mark) and keeps U+0085, so a value near MIN_SECRET_BYTES could pass in one
 * language and fail in another.
 */
const SURROUNDING_WHITE_SPACE =
  /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;

function trimWhiteSpace(value: string): string {
  return value.replace(SURROUNDING_WHITE_SPACE, "");
}

export type SecretProblemKind = "empty" | "placeholder" | "tooShort";

export interface SecretProblem {
  kind: SecretProblemKind;
  /** Names the config key and its WOOFX3_* variable; never includes the value. */
  message: string;
}

export type SecretResult = { ok: true; value: string } | { ok: false; error: SecretProblem };

const PROBLEM_TEXT: Record<SecretProblemKind, string> = {
  empty: "is not set",
  placeholder: "is a well-known example value",
  tooShort: `is shorter than ${MIN_SECRET_BYTES} bytes`,
};

function problemKind(trimmed: string): SecretProblemKind | null {
  if (trimmed === "") {
    return "empty";
  }
  if (PLACEHOLDER_SECRETS.has(trimmed.toLowerCase())) {
    return "placeholder";
  }
  if (Buffer.byteLength(trimmed, "utf8") < MIN_SECRET_BYTES) {
    return "tooShort";
  }
  return null;
}

/**
 * Checks the secret held by the config key `name` (for example
 * `barkloaderKey`). The value is trimmed, then refused when it is empty, a
 * known placeholder, or shorter than MIN_SECRET_BYTES. An accepted value comes
 * back unchanged, so every service signs with the same bytes.
 */
export function validateSecret(name: string, value: string): SecretResult {
  const kind = problemKind(trimWhiteSpace(value));
  if (kind === null) {
    return { ok: true, value };
  }
  const message = `${name} (WOOFX3_${camelToScreamingSnake(name)}) ${PROBLEM_TEXT[kind]}: set it to a random value of at least ${MIN_SECRET_BYTES} bytes`;
  return { ok: false, error: { kind, message } };
}
