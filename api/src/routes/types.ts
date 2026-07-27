import type { WorkflowDefinition } from "@woofx3/api";

export interface UninstallModuleResponse {
  requested: boolean;
}

export interface WorkflowItem {
  id: string;
  name: string;
  description: string;
  accountId: string;
  isEnabled: boolean;
  definition: WorkflowDefinition | null;
  stats: { runsToday: number; successRate: number };
  createdAt: string;
  updatedAt: string;
  taxonomy: string[];
}
