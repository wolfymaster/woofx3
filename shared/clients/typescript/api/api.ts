// Shared API Types for woofx3 UI and Backend

// ==================== User & Auth ====================

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
  teamIds: string[];
  accountIds: string[];
}

// ==================== Teams ====================

export interface Team {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  createdAt: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  status: "active" | "invited" | "inactive";
  joinedAt: string;
  avatarUrl?: string;
}

// ==================== Accounts ====================

export interface Account {
  id: string;
  name: string;
  platform: string;
  teamId: string;
  status: string;
  createdAt: string;
}

// ==================== Modules ====================

export interface Module {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  author: string;
  isInstalled: boolean;
  iconUrl: string;
}

export interface ModulesQuery {
  category?: string;
  search?: string;
  installed?: boolean;
  page?: number;
  pageSize?: number;
}

export interface PaginatedModules {
  modules: Module[];
  total: number;
  page: number;
  pageSize: number;
}

// ==================== Workflows ====================

export interface Workflow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  accountId: string;
  steps: unknown[];
  trigger?: unknown;
}

export interface WorkflowsQuery {
  accountId?: string;
  enabled?: boolean;
  page?: number;
  pageSize?: number;
}

export interface PaginatedWorkflows {
  workflows: Workflow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: "success" | "failed" | "running";
  startedAt: string;
  duration: number;
  trigger: string;
}

export interface WorkflowRunsQuery {
  workflowId?: string;
  accountId?: string;
  limit?: number;
}

// ==================== Assets ====================

export interface Asset {
  id: string;
  name: string;
  type: string;
  url: string;
  accountId: string;
  size: number;
  createdAt: string;
}

export interface AssetsQuery {
  accountId?: string;
  type?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedAssets {
  assets: Asset[];
  total: number;
  page: number;
  pageSize: number;
}

// ==================== Scenes ====================

export interface SceneWidget {
  id: string;
  type: string;
  position: { x: number; y: number };
  size: { w: number; h: number };
}

export interface Scene {
  id: string;
  name: string;
  accountId: string;
  widgets: SceneWidget[];
  createdAt: string;
}

export interface ScenesQuery {
  accountId?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedScenes {
  scenes: Scene[];
  total: number;
  page: number;
  pageSize: number;
}

// ==================== Chat & Events ====================

export interface ChatMessage {
  id: string;
  user: string;
  message: string;
  timestamp: string;
  badges: string[];
  color: string;
}

export interface StreamEvent {
  id: string;
  type: "follow" | "subscription" | "donation" | "raid" | "cheer" | "gift";
  user: string;
  amount?: number;
  message?: string;
  timestamp: string;
}

export interface StreamEventsQuery {
  accountId: string;
  limit?: number;
  types?: string[];
}

// ==================== User Preferences ====================

export interface UserPreferences {
  email: boolean;
  push: boolean;
  workflow: boolean;
  marketing: boolean;
}

// ==================== Dashboard ====================

export interface DashboardModule {
  id: string;
  type: string;
  title: string;
  position: { x: number; y: number };
  size: { w: number; h: number };
}

export interface DashboardStats {
  activeWorkflows: number;
  totalWorkflows: number;
  installedModules: number;
  totalModules: number;
  activeAccounts: number;
  recentEvents: number;
}

// ==================== API Interface ====================

/** RPC connectivity check; mirrors `GET /health` semantics. */
export type PingResponse = { status: "ok"; instanceId: string };

/**
 * Gateway is the capnweb entry point. Unauthenticated callers see only
 * `ping()` and `authenticate()`. A successful `authenticate()` returns
 * the full `StreamControlApi` stub.
 */
export interface StreamControlGateway {
  ping(): Promise<{ status: string }>;
  authenticate(clientId: string, clientSecret: string): StreamControlApi;
  registerClient(
    description: string,
    callbackUrl?: string,
    callbackToken?: string
  ): Promise<{ clientId: string; clientSecret: string }>;
}

export interface StreamControlApi {
  ping(): Promise<PingResponse>;

  // Client Management
  deleteClient(clientId: string): Promise<{ success: boolean; message: string }>;

  // User & Auth
  getUser(): Promise<User>;

  // Teams
  getTeams(): Promise<Team[]>;
  getTeam(id: string): Promise<Team | null>;
  getTeamMembers(teamId: string): Promise<TeamMember[]>;

  // Accounts
  getAccounts(teamId?: string): Promise<Account[]>;
  getAccount(id: string): Promise<Account | null>;

  // Modules
  getModules(query?: ModulesQuery): Promise<PaginatedModules>;
  getModule(id: string): Promise<Module | null>;
  installModule(id: string): Promise<{ success: boolean }>;
  uninstallModule(id: string): Promise<{ success: boolean }>;

  // Workflows
  getWorkflows(query?: WorkflowsQuery): Promise<PaginatedWorkflows>;
  getWorkflow(id: string): Promise<Workflow | null>;
  createWorkflow(data: {
    name: string;
    description: string;
    accountId: string;
    steps?: unknown[];
    trigger?: unknown;
  }): Promise<{ id: string }>;
  updateWorkflow(id: string, data: Partial<Workflow>): Promise<{ success: boolean }>;
  deleteWorkflow(id: string): Promise<{ success: boolean }>;
  getWorkflowRuns(query?: WorkflowRunsQuery): Promise<WorkflowRun[]>;

  // Assets
  getAssets(query?: AssetsQuery): Promise<PaginatedAssets>;
  getAsset(id: string): Promise<Asset | null>;
  createAsset(data: {
    name: string;
    type: string;
    url: string;
    accountId: string;
    size: number;
  }): Promise<{ id: string }>;
  deleteAsset(id: string): Promise<{ success: boolean }>;

  // Scenes
  getScenes(query?: ScenesQuery): Promise<PaginatedScenes>;
  getScene(id: string): Promise<Scene | null>;
  createScene(data: { name: string; accountId: string }): Promise<{ id: string }>;
  updateScene(id: string, data: Partial<Scene>): Promise<{ success: boolean }>;
  deleteScene(id: string): Promise<{ success: boolean }>;

  // Chat & Events
  getChatMessages(accountId: string, limit?: number): Promise<ChatMessage[]>;
  sendChatMessage(accountId: string, message: string): Promise<{ success: boolean; messageId: string }>;
  getStreamEvents(query: StreamEventsQuery): Promise<StreamEvent[]>;

  // User Preferences
  getUserPreferences(): Promise<UserPreferences>;
  updateUserPreferences(prefs: UserPreferences): Promise<{ success: boolean }>;

  // Dashboard
  getDashboardStats(): Promise<DashboardStats>;
  getDashboardLayout(accountId: string): Promise<DashboardModule[]>;
  saveDashboardLayout(accountId: string, modules: DashboardModule[]): Promise<{ success: boolean }>;
}
