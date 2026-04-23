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
    if (typeof def.trigger.eventType !== "string" || def.trigger.eventType.length === 0) {
      errors.push({ path: "trigger.eventType", message: "required string" });
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
