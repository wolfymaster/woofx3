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

/**
 * Pauses the run until a matching event arrives. With a `timeout`, the wait
 * ends when it passes and `onTimeout` decides what happens; without one it
 * waits for the event however long that takes.
 */
export interface EventWaitConfig {
  type: "event" | "aggregation";
  event: string;
  conditions?: ConditionConfig[];
  aggregation?: AggregationConfig;
  /**
   * A Go duration string such as "30s" or "2m", at least WAIT_TIMEOUT_MIN_MS.
   * Not a number: the engine reads a bare number as nanoseconds.
   */
  timeout?: string;
  /** Defaults to "fail". Only applies when `timeout` is set. */
  onTimeout?: "continue" | "fail";
}

/** Must match MinWaitTimeout in workflow/internal/tasks/wait.go. */
export const WAIT_TIMEOUT_MIN_MS = 1000;

/**
 * Bounds of `DelayWaitConfig.durationMs`, inclusive. Must match MinDelayMs and
 * MaxDelayMs in workflow/internal/tasks/wait.go, which refuses a workflow
 * outside them.
 */
export const WAIT_DELAY_MIN_MS = 1;
export const WAIT_DELAY_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * Pauses the run for a fixed time, then continues. Takes no event, conditions,
 * timeout or onTimeout: the engine refuses a delay that carries them.
 */
export interface DelayWaitConfig {
  type: "delay";
  durationMs: number;
}

export type WaitConfig = EventWaitConfig | DelayWaitConfig;

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
  /**
   * Switches the task off without removing it. A disabled `condition` resolves
   * as false without evaluating, so its `onTrue` tasks are skipped and
   * `${id.result}` reads false; any other disabled task is skipped. Mirrors
   * `TaskDefinition.Disabled` in workflow/internal/types/types.go.
   */
  disabled?: boolean;

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
