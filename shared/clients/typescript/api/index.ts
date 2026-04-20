export * from "./api";
export * from "./client";
export * from "./rpc";
export * from "./ui-schema";
export * from "./webhooks";
// workflow-definition.ts exports a `TriggerConfig` name that collides with
// the form-schema `TriggerConfig` in ui-schema.ts. Re-export the canonical
// WorkflowDefinition types explicitly to avoid the ambiguity. Consumers
// that want the workflow-kind `TriggerConfig` import it from the subpath
// `@woofx3/api/workflow-definition`.
export type {
  AggregationConfig,
  ConditionConfig,
  ConditionOperator,
  Duration,
  SubWorkflowConfig,
  TaskDefinition,
  TaskType,
  WaitConfig,
  WorkflowDefinition,
  WorkflowOptions,
} from "./workflow-definition";
