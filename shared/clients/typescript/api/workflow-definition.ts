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

export interface TriggerConfig {
  type: "event";
  eventType: string;
  conditions?: ConditionConfig[];
}

export interface AggregationConfig {
  strategy: "count" | "sum" | "threshold";
  field?: string;
  threshold: number;
  timeWindow?: Duration;
}

export interface WaitConfig {
  type: "event" | "aggregation";
  eventType: string;
  conditions?: ConditionConfig[];
  aggregation?: AggregationConfig;
  timeout?: Duration;
  onTimeout?: "continue" | "fail";
}

export interface SubWorkflowConfig {
  workflowId: string;
  waitUntilCompletion?: boolean;
  eventType?: string;
  eventData?: Record<string, unknown>;
  timeout?: Duration;
}

export type TaskType = "action" | "log" | "wait" | "condition" | "workflow";

export interface TaskDefinition {
  id: string;
  type: TaskType;
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
