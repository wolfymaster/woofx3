import type { ValidationError } from "./validate-definition";

/**
 * Parameter checks for the engine's native `twitch.*` actions, so a step the
 * engine would refuse is refused when it is saved, with a path the editor can
 * point at. Must match the parsers in workflow/internal/actions/twitch.go,
 * which check again when the workflow registers and when the step runs.
 *
 * A value containing `${` is only known once the run resolves it, so it is
 * accepted here unseen. A blank text field reads as not set.
 */

const TITLE_MAX_LENGTH = 140;
const MARKER_DESCRIPTION_MAX_LENGTH = 140;
const REASON_MAX_LENGTH = 500;
const TAGS_MAX_COUNT = 10;
const TAG_MAX_LENGTH = 25;
const TIMEOUT_MAX_SECONDS = 1_209_600;
const TAG_PATTERN = /^[\p{L}\p{M}\p{N}]+$/u;

type Params = Record<string, unknown>;
type Check = (params: Params, prefix: string, errors: ValidationError[]) => void;

function isExpression(value: unknown): boolean {
  return typeof value === "string" && value.includes("${");
}

/** Characters as Twitch counts them, not UTF-16 units. */
function characterCount(text: string): number {
  return [...text].length;
}

/** The trimmed text of an optional field; "" when absent. Reports a non-text value. */
function text(params: Params, field: string, prefix: string, errors: ValidationError[]): string {
  const value = params[field];
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value !== "string") {
    errors.push({ path: `${prefix}.${field}`, message: "must be text" });
    return "";
  }
  return value.trim();
}

function maxLength(value: string, max: number, field: string, prefix: string, errors: ValidationError[]): void {
  if (value && !isExpression(value) && characterCount(value) > max) {
    errors.push({ path: `${prefix}.${field}`, message: `at most ${max} characters (got ${characterCount(value)})` });
  }
}

function requireTarget(params: Params, prefix: string, errors: ValidationError[]): void {
  const userId = text(params, "userId", prefix, errors);
  const userName = text(params, "userName", prefix, errors);
  if (!userId && !userName) {
    errors.push({ path: `${prefix}.userName`, message: "userName or userId is required" });
  }
}

function checkTags(params: Params, prefix: string, errors: ValidationError[]): boolean {
  const value = params.tags;
  const path = `${prefix}.tags`;
  let tags: string[];
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    if (!value.trim()) {
      return false;
    }
    if (isExpression(value)) {
      return true;
    }
    tags = value
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag);
  } else if (Array.isArray(value)) {
    if (value.some((tag) => typeof tag !== "string")) {
      errors.push({ path, message: "tags must be text" });
      return true;
    }
    if (value.length === 0) {
      return false;
    }
    if (value.some(isExpression)) {
      return true;
    }
    tags = (value as string[]).map((tag) => tag.trim());
  } else {
    errors.push({ path, message: "tags must be text or a list" });
    return true;
  }

  if (tags.length > TAGS_MAX_COUNT) {
    errors.push({ path, message: `${tags.length} tags given; Twitch allows at most ${TAGS_MAX_COUNT}` });
  }
  const seen = new Set<string>();
  for (const tag of tags) {
    if (!tag) {
      errors.push({ path, message: "a tag cannot be empty" });
    } else if (characterCount(tag) > TAG_MAX_LENGTH) {
      errors.push({ path, message: `tag "${tag}" is longer than ${TAG_MAX_LENGTH} characters` });
    } else if (!TAG_PATTERN.test(tag)) {
      errors.push({ path, message: `tag "${tag}" may only contain letters and numbers` });
    } else if (seen.has(tag.toLowerCase())) {
      errors.push({ path, message: `tag "${tag}" is listed twice` });
    }
    seen.add(tag.toLowerCase());
  }
  return true;
}

const CHECKS: Record<string, Check> = {
  "twitch.shoutout": (params, prefix, errors) => {
    requireTarget(params, prefix, errors);
    const skip = params.skipIfRateLimited;
    if (
      skip !== undefined &&
      skip !== null &&
      typeof skip !== "boolean" &&
      skip !== "" &&
      skip !== "true" &&
      skip !== "false" &&
      !isExpression(skip)
    ) {
      errors.push({ path: `${prefix}.skipIfRateLimited`, message: "must be true or false" });
    }
  },
  "twitch.clip": () => {},
  "twitch.marker": (params, prefix, errors) => {
    maxLength(
      text(params, "description", prefix, errors),
      MARKER_DESCRIPTION_MAX_LENGTH,
      "description",
      prefix,
      errors
    );
  },
  "twitch.update_stream": (params, prefix, errors) => {
    const title = text(params, "title", prefix, errors);
    maxLength(title, TITLE_MAX_LENGTH, "title", prefix, errors);
    const category = text(params, "category", prefix, errors);
    const hasTags = checkTags(params, prefix, errors);
    if (!title && !category && !hasTags) {
      errors.push({ path: prefix, message: "set at least one of title, category or tags" });
    }
  },
  "twitch.timeout": (params, prefix, errors) => {
    requireTarget(params, prefix, errors);
    const duration = params.durationSeconds;
    const path = `${prefix}.durationSeconds`;
    if (duration === undefined || duration === null || duration === "") {
      errors.push({ path, message: "required" });
    } else if (!isExpression(duration)) {
      const seconds = typeof duration === "string" ? Number(duration.trim()) : duration;
      if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 1 || seconds > TIMEOUT_MAX_SECONDS) {
        errors.push({ path, message: `a whole number of seconds from 1 to ${TIMEOUT_MAX_SECONDS}` });
      }
    }
    maxLength(text(params, "reason", prefix, errors), REASON_MAX_LENGTH, "reason", prefix, errors);
  },
};

/** Reports the problems with a `twitch.*` step's parameters; other actions pass. */
export function validateTwitchActionParams(
  action: string,
  parameters: Params | undefined,
  prefix: string,
  errors: ValidationError[]
): void {
  if (!Object.hasOwn(CHECKS, action)) {
    return;
  }
  CHECKS[action](parameters ?? {}, prefix, errors);
}
