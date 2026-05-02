/**
 * Canonical workflow JSON schema — source of truth for workflow execution
 * definition. Mirrors woofx3/docs/workflow/schema.md. No UI concerns (no
 * positions, no node types) — execution only.
 */

export type Duration = string | number; // e.g. "30s" or raw nanoseconds

export type ConditionOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "in"
  | "not_in"
  | "exists"
  | "not_exists"
  | "regex"
  | "between";

export interface ConditionConfig {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
}

// Schedule cron grammar follows robfig/cron/v3 (5-field, no seconds).
// Examples: "0 * * * *" (top of every hour), "*/15 * * * *" (every 15 min).
export type TriggerConfig =
  | { type: "event"; event: string; conditions?: ConditionConfig[] }
  | { type: "schedule"; schedule: string; conditions?: ConditionConfig[] };

export interface AggregationConfig {
  strategy: "count" | "sum" | "threshold";
  field?: string;
  threshold: number;
  timeWindow?: Duration;
}

export interface WaitConfig {
  type: "event" | "aggregation";
  event: string;
  conditions?: ConditionConfig[];
  aggregation?: AggregationConfig;
  timeout?: Duration;
  onTimeout?: "continue" | "fail";
}

export interface SubWorkflowConfig {
  workflowId: string;
  waitUntilCompletion?: boolean;
  event?: string;
  eventData?: Record<string, unknown>;
  timeout?: Duration;
}

export type TaskType = "action" | "log" | "wait" | "condition" | "workflow";

export interface TaskDefinition {
  id: string;
  type: TaskType;
  /**
   * Registered action name — required when `type === "action"`, ignored otherwise.
   * Separated from `parameters` so dispatch config and handler inputs don't share
   * a namespace, matching the pattern used by wait/workflow/condition tasks.
   */
  action?: string;
  dependsOn?: string[];
  parameters?: Record<string, unknown>;
  exports?: Record<string, string>;
  onError?: "fail" | "continue";
  timeout?: Duration;

  condition?: ConditionConfig;
  conditions?: ConditionConfig[];
  conditionLogic?: "and" | "or";
  onTrue?: string[];
  onFalse?: string[];

  wait?: WaitConfig;
  workflow?: SubWorkflowConfig;
}

export interface WorkflowOptions {
  timeout?: Duration;
  maxConcurrent?: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  trigger: TriggerConfig;
  tasks: TaskDefinition[];
  options?: WorkflowOptions;
}
