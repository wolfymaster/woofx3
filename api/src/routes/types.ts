import type { WorkflowDefinition } from "@woofx3/api";

export interface UninstallModuleResponse {
  requested: boolean;
}

export interface WorkflowItem {
  id: string;
  name: string;
  description: string;
  isEnabled: boolean;
  definition: WorkflowDefinition | null;
  revision?: number;
  stats: { runsToday: number; successRate: number };
  createdAt: string;
  updatedAt: string;
  taxonomy: string[];
}
