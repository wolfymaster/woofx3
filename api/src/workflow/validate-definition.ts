import type { ConditionConfig, ConditionOperator, TaskDefinition, WorkflowDefinition } from "@woofx3/api";

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult = { ok: true; value: WorkflowDefinition } | { ok: false; errors: ValidationError[] };

const OPERATORS: ReadonlySet<ConditionOperator> = new Set([
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
  "exists",
  "not_exists",
  "regex",
  "between",
]);

const TASK_TYPES = new Set(["action", "log", "wait", "condition", "workflow"]);

// Shape check for a 5-field cron expression (robfig/cron/v3 style, no seconds).
// Accepts numbers, ranges, steps, lists, wildcards, or a single "?".
function isValidCronExpression(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return false;
  }
  const fieldRe = /^(\*|\?|(\*|\d+)(\/\d+)?|(\d+(-\d+)?)(,\d+(-\d+)?)*)$/;
  return fields.every((f) => fieldRe.test(f));
}

function validateConditions(cs: ConditionConfig[] | undefined, prefix: string, errors: ValidationError[]): void {
  if (!cs) {
    return;
  }
  cs.forEach((c, i) => {
    const base = `${prefix}[${i}]`;
    if (typeof c.field !== "string" || c.field.length === 0) {
      errors.push({ path: `${base}.field`, message: "required string" });
    }
    if (!OPERATORS.has(c.operator)) {
      errors.push({ path: `${base}.operator`, message: `unknown operator: ${String(c.operator)}` });
    }
  });
}

export function validateWorkflowDefinition(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== "object") {
    return { ok: false, errors: [{ path: "", message: "definition must be an object" }] };
  }
  const def = input as Partial<WorkflowDefinition>;

  if (typeof def.id !== "string" || def.id.length === 0) {
    errors.push({ path: "id", message: "required string" });
  }
  if (typeof def.name !== "string" || def.name.length === 0) {
    errors.push({ path: "name", message: "required string" });
  }

  if (!def.trigger || typeof def.trigger !== "object") {
    errors.push({ path: "trigger", message: "required object" });
  } else if (def.trigger.type === "event") {
    if (typeof def.trigger.event !== "string" || def.trigger.event.length === 0) {
      errors.push({ path: "trigger.event", message: "required string" });
    }
    validateConditions(def.trigger.conditions, "trigger.conditions", errors);
  } else if (def.trigger.type === "schedule") {
    const schedule = def.trigger.schedule;
    if (typeof schedule !== "string" || schedule.length === 0) {
      errors.push({ path: "trigger.schedule", message: "required: cron expression cannot be empty" });
    } else if (!isValidCronExpression(schedule)) {
      errors.push({
        path: "trigger.schedule",
        message: "invalid cron expression (expected 5 whitespace-separated fields)",
      });
    }
    validateConditions(def.trigger.conditions, "trigger.conditions", errors);
  } else {
    errors.push({ path: "trigger.type", message: 'must be "event" or "schedule"' });
  }

  if (!Array.isArray(def.tasks) || def.tasks.length === 0) {
    errors.push({ path: "tasks", message: "required non-empty array" });
  } else {
    const ids = new Set<string>();
    for (const t of def.tasks) {
      if (typeof t.id !== "string" || t.id.length === 0) {
        continue;
      }
      if (ids.has(t.id)) {
        errors.push({ path: `tasks.${t.id}`, message: "duplicate task id" });
      }
      ids.add(t.id);
    }

    def.tasks.forEach((t: TaskDefinition, i: number) => {
      const p = `tasks[${i}]`;
      if (typeof t.id !== "string" || t.id.length === 0) {
        errors.push({ path: `${p}.id`, message: "required string" });
      }
      if (!TASK_TYPES.has(t.type)) {
        errors.push({ path: `${p}.type`, message: `unknown task type: ${String(t.type)}` });
      }
      if (t.type === "action" && (typeof t.action !== "string" || t.action.length === 0)) {
        errors.push({ path: `${p}.action`, message: "required non-empty string for action tasks" });
      }
      validateConditions(t.conditions, `${p}.conditions`, errors);
      if (t.condition) {
        validateConditions([t.condition], `${p}.condition`, errors);
      }
      if (t.type === "action" && typeof t.action === "string" && Object.hasOwn(OBS_ACTION_PARAMS, t.action)) {
        validateObsActionParams(OBS_ACTION_PARAMS[t.action], t.parameters, `${p}.parameters`, errors);
      }

      (t.dependsOn ?? []).forEach((d, j) => {
        if (!ids.has(d)) {
          errors.push({ path: `${p}.dependsOn[${j}]`, message: `unknown task id: ${d}` });
        }
      });
      (t.onTrue ?? []).forEach((r, j) => {
        if (!ids.has(r)) {
          errors.push({ path: `${p}.onTrue[${j}]`, message: `unknown task id: ${r}` });
        }
      });
      (t.onFalse ?? []).forEach((r, j) => {
        if (!ids.has(r)) {
          errors.push({ path: `${p}.onFalse[${j}]`, message: `unknown task id: ${r}` });
        }
      });
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: input as WorkflowDefinition };
}

type ObsParamRule = "requiredString" | "optionalString" | "optionalBoolean";

/**
 * Parameters of the engine's native `obs.*` actions. Mirrors `obsActions` in
 * workflow/obs_actions.go, so a step the engine would refuse at run time is
 * refused when it is saved, with the path the editor can point at. The
 * booleans are optional: the engine defaults an absent one to true.
 */
const OBS_ACTION_PARAMS: Record<string, Record<string, ObsParamRule>> = {
  "obs.switch_scene": { sceneName: "requiredString" },
  "obs.set_source_visibility": {
    sceneName: "optionalString",
    sourceName: "requiredString",
    visible: "optionalBoolean",
  },
  "obs.set_input_mute": { inputName: "requiredString", muted: "optionalBoolean" },
};

// A value built from an expression is only known once the run resolves it,
// so its type is the engine's to check then.
function isExpression(value: unknown): boolean {
  return typeof value === "string" && value.includes("${");
}

function validateObsActionParams(
  rules: Record<string, ObsParamRule>,
  parameters: Record<string, unknown> | undefined,
  prefix: string,
  errors: ValidationError[]
): void {
  const params = parameters ?? {};
  for (const [field, rule] of Object.entries(rules)) {
    const value = params[field];
    const path = `${prefix}.${field}`;
    if (rule === "requiredString" && (typeof value !== "string" || value.length === 0)) {
      errors.push({ path, message: "required non-empty string" });
    }
    if (rule === "optionalString" && value !== undefined && value !== null && typeof value !== "string") {
      errors.push({ path, message: "must be a string when set" });
    }
    if (
      rule === "optionalBoolean" &&
      value !== undefined &&
      value !== null &&
      typeof value !== "boolean" &&
      value !== "true" &&
      value !== "false" &&
      !isExpression(value)
    ) {
      errors.push({ path, message: "must be true or false" });
    }
  }
}
