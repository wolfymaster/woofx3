import {
  CONFIG_BUNDLE_FORMAT,
  CONFIG_BUNDLE_VERSION,
  CONFIG_SECTIONS,
  type ConfigBundle,
  type ConfigBundleCommand,
  type ConfigBundleGroup,
  type ConfigBundleRequirement,
  type ConfigBundleResource,
  type ConfigBundleWorkflow,
  type ConfigConflictPolicy,
  type ConfigSection,
} from "@woofx3/api";

/**
 * The largest bundle import will read. A creator's whole setup is tens of
 * kilobytes; the cap exists so a wrong file (a video, a database dump) is
 * refused before it is parsed rather than after it has been held in memory.
 */
export const MAX_CONFIG_BUNDLE_BYTES = 5 * 1024 * 1024;

/** Stops a malformed bundle from producing an error message longer than the bundle. */
const MAX_REPORTED_ERRORS = 20;

/**
 * Items per section. Far past any real setup, and low enough that a generated
 * bundle cannot turn one import into tens of thousands of writes.
 */
export const MAX_CONFIG_SECTION_ITEMS = 1000;

const CONFLICT_POLICIES: readonly ConfigConflictPolicy[] = ["skip", "rename", "overwrite"];
const VISIBILITIES = ["public", "restricted"] as const;

/**
 * Collects every problem with a bundle before failing, so a person fixing a
 * hand-edited file sees all of them at once instead of one per attempt.
 */
class ShapeErrors {
  readonly messages: string[] = [];

  add(path: string, message: string): void {
    this.messages.push(`${path}: ${message}`);
  }

  throwIfAny(): void {
    if (this.messages.length === 0) {
      return;
    }
    const shown = this.messages.slice(0, MAX_REPORTED_ERRORS);
    const hidden = this.messages.length - shown.length;
    const suffix = hidden > 0 ? `; and ${hidden} more` : "";
    throw new Error(`Invalid config bundle: ${shown.join("; ")}${suffix}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Refuse keys the format does not define. A bundle is a contract between two
 * engines; an unknown key is either a newer format this engine does not
 * understand or a hand edit gone wrong, and silently dropping it would import
 * something other than what the file says.
 */
function checkKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: ShapeErrors
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      errors.add(path, `unknown field "${key}"`);
    }
  }
}

function checkString(value: unknown, path: string, errors: ShapeErrors, { nonEmpty = false } = {}): value is string {
  if (typeof value !== "string") {
    errors.add(path, "must be a string");
    return false;
  }
  if (nonEmpty && value.trim().length === 0) {
    errors.add(path, "must not be empty");
    return false;
  }
  return true;
}

function checkStringArray(value: unknown, path: string, errors: ShapeErrors): value is string[] {
  if (!Array.isArray(value)) {
    errors.add(path, "must be an array of strings");
    return false;
  }
  let ok = true;
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      errors.add(`${path}[${index}]`, "must be a non-empty string");
      ok = false;
    }
  });
  return ok;
}

function checkNumber(value: unknown, path: string, errors: ShapeErrors): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.add(path, "must be a finite number");
  }
}

function checkBoolean(value: unknown, path: string, errors: ShapeErrors): void {
  if (typeof value !== "boolean") {
    errors.add(path, "must be a boolean");
  }
}

function checkSection<T>(
  bundle: Record<string, unknown>,
  section: ConfigSection,
  identity: (item: Record<string, unknown>) => unknown,
  checkItem: (item: Record<string, unknown>, path: string, errors: ShapeErrors) => void,
  errors: ShapeErrors
): T[] {
  const raw = bundle[section];
  if (!Array.isArray(raw)) {
    errors.add(section, "must be an array");
    return [];
  }
  if (raw.length > MAX_CONFIG_SECTION_ITEMS) {
    errors.add(section, `has ${raw.length} items; the limit is ${MAX_CONFIG_SECTION_ITEMS}`);
    return [];
  }
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const path = `${section}[${index}]`;
    if (!isPlainObject(item)) {
      errors.add(path, "must be an object");
      return;
    }
    checkItem(item, path, errors);
    const key = identity(item);
    if (typeof key === "string") {
      if (seen.has(key)) {
        errors.add(path, `duplicate "${key}"; each item in a section must be unique`);
      }
      seen.add(key);
    }
  });
  return raw as T[];
}

function checkWorkflow(item: Record<string, unknown>, path: string, errors: ShapeErrors): void {
  checkKeys(item, ["name", "enabled", "definition", "workflowRefs", "requires"], path, errors);
  checkString(item.name, `${path}.name`, errors, { nonEmpty: true });
  checkBoolean(item.enabled, `${path}.enabled`, errors);
  checkStringArray(item.requires, `${path}.requires`, errors);
  if (!isPlainObject(item.definition)) {
    errors.add(`${path}.definition`, "must be an object");
  } else {
    if ("id" in item.definition) {
      errors.add(`${path}.definition.id`, "must be absent; a bundle carries no ids");
    }
    if (item.definition.name !== item.name) {
      errors.add(`${path}.definition.name`, "must equal the workflow's name");
    }
  }
  if (!isPlainObject(item.workflowRefs)) {
    errors.add(`${path}.workflowRefs`, "must be an object");
  } else {
    for (const [taskId, name] of Object.entries(item.workflowRefs)) {
      checkString(name, `${path}.workflowRefs.${taskId}`, errors, { nonEmpty: true });
    }
  }
  checkSubWorkflowIds(item, path, errors);
}

/**
 * A sub-workflow step names its target through `workflowRefs`, never by a raw
 * id: an id from another engine would point at whatever happens to hold it
 * here, or at nothing.
 */
function checkSubWorkflowIds(item: Record<string, unknown>, path: string, errors: ShapeErrors): void {
  const tasks = isPlainObject(item.definition) ? item.definition.tasks : undefined;
  if (!Array.isArray(tasks)) {
    return;
  }
  tasks.forEach((task, index) => {
    if (!isPlainObject(task) || !isPlainObject(task.workflow)) {
      return;
    }
    const workflowId = task.workflow.workflowId;
    if (typeof workflowId === "string" && workflowId !== "") {
      errors.add(
        `${path}.definition.tasks[${index}].workflow.workflowId`,
        "must be empty; name the target workflow in workflowRefs"
      );
    }
  });
}

function checkCommand(item: Record<string, unknown>, path: string, errors: ShapeErrors): void {
  checkKeys(
    item,
    [
      "command",
      "enabled",
      "cooldown",
      "priority",
      "visibility",
      "argumentPattern",
      "actions",
      "groups",
      "usernames",
      "requires",
    ],
    path,
    errors
  );
  checkString(item.command, `${path}.command`, errors, { nonEmpty: true });
  checkBoolean(item.enabled, `${path}.enabled`, errors);
  checkNumber(item.cooldown, `${path}.cooldown`, errors);
  checkNumber(item.priority, `${path}.priority`, errors);
  if (!VISIBILITIES.includes(item.visibility as (typeof VISIBILITIES)[number])) {
    errors.add(`${path}.visibility`, `must be one of ${VISIBILITIES.join(", ")}`);
  }
  checkString(item.argumentPattern, `${path}.argumentPattern`, errors);
  if (!Array.isArray(item.actions)) {
    errors.add(`${path}.actions`, "must be an array");
  } else {
    item.actions.forEach((action, index) => {
      if (!isPlainObject(action)) {
        errors.add(`${path}.actions[${index}]`, "must be an object");
      }
    });
  }
  checkStringArray(item.groups, `${path}.groups`, errors);
  if (item.usernames !== undefined) {
    checkStringArray(item.usernames, `${path}.usernames`, errors);
  }
  checkStringArray(item.requires, `${path}.requires`, errors);
}

function checkGroup(item: Record<string, unknown>, path: string, errors: ShapeErrors): void {
  checkKeys(item, ["name", "description", "members"], path, errors);
  checkString(item.name, `${path}.name`, errors, { nonEmpty: true });
  checkString(item.description, `${path}.description`, errors);
  if (item.members !== undefined) {
    checkStringArray(item.members, `${path}.members`, errors);
  }
}

/** Mirrors the allowed characters of a manifest id; `:` is the canonical id separator. */
const CANONICAL_SEGMENT = /^[A-Za-z0-9._-]+$/;

function checkResource(item: Record<string, unknown>, path: string, errors: ShapeErrors): void {
  checkKeys(item, ["module", "kind", "instanceId", "displayName", "settings", "requires"], path, errors);
  for (const field of ["module", "kind", "instanceId"] as const) {
    if (checkString(item[field], `${path}.${field}`, errors, { nonEmpty: true })) {
      if (!CANONICAL_SEGMENT.test(item[field] as string)) {
        errors.add(`${path}.${field}`, "may only contain letters, digits, '.', '_' and '-'");
      }
    }
  }
  checkString(item.displayName, `${path}.displayName`, errors);
  if (!isPlainObject(item.settings)) {
    errors.add(`${path}.settings`, "must be an object");
  }
  checkStringArray(item.requires, `${path}.requires`, errors);
}

function checkRequirement(item: unknown, path: string, errors: ShapeErrors): void {
  if (!isPlainObject(item)) {
    errors.add(path, "must be an object");
    return;
  }
  checkKeys(item, ["moduleId", "version"], path, errors);
  checkString(item.moduleId, `${path}.moduleId`, errors, { nonEmpty: true });
  checkString(item.version, `${path}.version`, errors);
}

export function canonicalResourceId(resource: Pick<ConfigBundleResource, "module" | "kind" | "instanceId">): string {
  return `${resource.module}:${resource.kind}:${resource.instanceId}`;
}

function measure(input: unknown): { bytes: number; value: unknown } {
  if (typeof input === "string") {
    return { bytes: new TextEncoder().encode(input).byteLength, value: undefined };
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new Error("Invalid config bundle: not serializable as JSON");
  }
  if (serialized === undefined) {
    throw new Error("Invalid config bundle: expected a JSON object");
  }
  return { bytes: new TextEncoder().encode(serialized).byteLength, value: input };
}

/**
 * Accept a bundle as the object a client decoded or as the file's raw text,
 * and return it only if every part of it has the shape the format defines.
 *
 * Nothing about the target engine is consulted here: that is the import plan's
 * job. This answers only "is this a version 1 bundle", so a bad file fails
 * before anything reads the engine's state.
 */
export function parseConfigBundle(input: unknown): ConfigBundle {
  const { bytes, value } = measure(input);
  if (bytes > MAX_CONFIG_BUNDLE_BYTES) {
    throw new Error(`Invalid config bundle: ${bytes} bytes exceeds the ${MAX_CONFIG_BUNDLE_BYTES}-byte limit`);
  }
  let raw: unknown = value;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (err) {
      throw new Error(`Invalid config bundle: not valid JSON (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  if (!isPlainObject(raw)) {
    throw new Error("Invalid config bundle: expected a JSON object");
  }
  if (raw.format !== CONFIG_BUNDLE_FORMAT) {
    throw new Error(`Invalid config bundle: format must be "${CONFIG_BUNDLE_FORMAT}"`);
  }
  if (raw.version !== CONFIG_BUNDLE_VERSION) {
    throw new Error(
      `Unsupported config bundle version ${JSON.stringify(raw.version)}; this engine reads version ${CONFIG_BUNDLE_VERSION}`
    );
  }

  const errors = new ShapeErrors();
  checkKeys(
    raw,
    [
      "format",
      "version",
      "exportedAt",
      "engineVersion",
      "includeMembers",
      "requires",
      "workflows",
      "commands",
      "groups",
      "resources",
    ],
    "bundle",
    errors
  );
  if (checkString(raw.exportedAt, "exportedAt", errors) && Number.isNaN(Date.parse(raw.exportedAt))) {
    errors.add("exportedAt", "must be an ISO 8601 timestamp");
  }
  checkString(raw.engineVersion, "engineVersion", errors);
  checkBoolean(raw.includeMembers, "includeMembers", errors);
  if (!Array.isArray(raw.requires)) {
    errors.add("requires", "must be an array");
  } else {
    for (const [index, req] of raw.requires.entries()) {
      checkRequirement(req, `requires[${index}]`, errors);
    }
  }

  checkSection<ConfigBundleWorkflow>(raw, "workflows", (w) => w.name, checkWorkflow, errors);
  checkSection<ConfigBundleCommand>(
    raw,
    "commands",
    (c) => (typeof c.command === "string" ? c.command.toLowerCase() : undefined),
    checkCommand,
    errors
  );
  checkSection<ConfigBundleGroup>(raw, "groups", (g) => g.name, checkGroup, errors);
  checkSection<ConfigBundleResource>(
    raw,
    "resources",
    (r) =>
      typeof r.module === "string" && typeof r.kind === "string" && typeof r.instanceId === "string"
        ? canonicalResourceId(r as unknown as ConfigBundleResource)
        : undefined,
    checkResource,
    errors
  );

  if (Array.isArray(raw.requires)) {
    const declared = new Set(
      (raw.requires as unknown[]).filter(isPlainObject).map((r) => (r as unknown as ConfigBundleRequirement).moduleId)
    );
    for (const section of CONFIG_SECTIONS) {
      const items = raw[section];
      if (!Array.isArray(items)) {
        continue;
      }
      items.forEach((item, index) => {
        if (!isPlainObject(item) || !Array.isArray(item.requires)) {
          return;
        }
        for (const moduleId of item.requires) {
          if (typeof moduleId === "string" && !declared.has(moduleId)) {
            errors.add(`${section}[${index}].requires`, `"${moduleId}" is not listed in the bundle's requires`);
          }
        }
      });
    }
  }

  errors.throwIfAny();
  return raw as unknown as ConfigBundle;
}

/** The sections an export or import covers; every section when none are named. */
export function parseSections(include: unknown): ReadonlySet<ConfigSection> {
  if (include === undefined) {
    return new Set(CONFIG_SECTIONS);
  }
  if (!Array.isArray(include)) {
    throw new Error(`include must be an array of: ${CONFIG_SECTIONS.join(", ")}`);
  }
  for (const section of include) {
    if (!CONFIG_SECTIONS.includes(section as ConfigSection)) {
      throw new Error(`include: unknown section ${JSON.stringify(section)}; expected ${CONFIG_SECTIONS.join(", ")}`);
    }
  }
  return new Set(include as ConfigSection[]);
}

export function parseConflictPolicy(policy: unknown): ConfigConflictPolicy {
  if (policy === undefined) {
    return "skip";
  }
  if (!CONFLICT_POLICIES.includes(policy as ConfigConflictPolicy)) {
    throw new Error(`onConflict must be one of ${CONFLICT_POLICIES.join(", ")}`);
  }
  return policy as ConfigConflictPolicy;
}

/**
 * A JSON value with every object's keys sorted, recursively. Two items are the
 * same exactly when their canonical forms serialize identically, and an export
 * lists keys in the same order every time, so two exports of an unchanged
 * setup differ only in `exportedAt`.
 */
export function canonicalize<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry)) as T;
  }
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry !== undefined) {
        sorted[key] = canonicalize(entry);
      }
    }
    return sorted as T;
  }
  return value;
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}
