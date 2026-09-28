import type { ConditionConfig, ConditionOperator, TaskDefinition, WorkflowDefinition } from "@woofx3/api";
// The module itself rather than the package index: the index also loads the
// RPC client and its dependencies, which a value import would pull in.
import { WAIT_DELAY_MAX_MS, WAIT_DELAY_MIN_MS } from "@woofx3/api/workflow-definition";

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

// Mirrors ValidateWaitConfig in workflow/internal/tasks/wait.go, so a wait the
// engine would refuse to register is refused here with a path the editor can
// point at. A missing `type` reads as "event", as it does in the engine.
function validateWait(wait: unknown, prefix: string, errors: ValidationError[]): void {
  if (!wait || typeof wait !== "object") {
    errors.push({ path: prefix, message: "required object for wait tasks" });
    return;
  }
  const w = wait as Record<string, unknown>;
  const type = w.type ?? "event";

  if (type === "delay") {
    const ms = w.durationMs;
    if (typeof ms !== "number" || !Number.isInteger(ms) || ms < WAIT_DELAY_MIN_MS || ms > WAIT_DELAY_MAX_MS) {
      errors.push({
        path: `${prefix}.durationMs`,
        message: `required integer between ${WAIT_DELAY_MIN_MS} and ${WAIT_DELAY_MAX_MS}`,
      });
    }
    for (const field of ["event", "conditions", "aggregation", "timeout", "onTimeout"]) {
      if (w[field] !== undefined) {
        errors.push({ path: `${prefix}.${field}`, message: "not allowed on a delay wait" });
      }
    }
    return;
  }

  if (type !== "event" && type !== "aggregation") {
    errors.push({ path: `${prefix}.type`, message: 'must be "event", "aggregation" or "delay"' });
    return;
  }
  if (typeof w.event !== "string" || w.event.length === 0) {
    errors.push({ path: `${prefix}.event`, message: "required string" });
  }
  if (type === "aggregation" && (!w.aggregation || typeof w.aggregation !== "object")) {
    errors.push({ path: `${prefix}.aggregation`, message: "required object for aggregation waits" });
  }
  if (w.durationMs !== undefined) {
    errors.push({ path: `${prefix}.durationMs`, message: "only allowed on a delay wait" });
  }
  if (w.onTimeout !== undefined && w.onTimeout !== "continue" && w.onTimeout !== "fail") {
    errors.push({ path: `${prefix}.onTimeout`, message: 'must be "continue" or "fail"' });
  }
  validateConditions(w.conditions as ConditionConfig[] | undefined, `${prefix}.conditions`, errors);
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
      if (t.type === "wait") {
        validateWait(t.wait, `${p}.wait`, errors);
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
