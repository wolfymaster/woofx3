/**
 * A creator's configuration as a portable file: the workflows, chat commands,
 * command groups and module resource instances they built, in a shape that can
 * be backed up, moved to another engine, or handed to a friend.
 *
 * Everything in a bundle is addressed by what a person would recognise -- a
 * workflow or group name, a command word, a resource's canonical id -- never
 * by a database id. Ids are minted per engine, so a bundle that carried them
 * would mean nothing anywhere but where it was made.
 *
 * What a bundle never carries: the engine's stored credentials (tokens, API
 * clients, the webhook signing secret, overlay tokens), module settings (the
 * only place a `secret` value can live), and the live values of counters,
 * timers and queues. Step parameters, command actions and resource settings
 * go verbatim, so anything a creator pasted into one goes too. Group members
 * and per-user command grants are usernames -- personal data -- and are left
 * out unless the export asks for them with `includeMembers`, and import adds
 * them only with `applyMembers`.
 *
 * See docs/services/config-bundles.md.
 */
import type { ActionStep, CommandVisibility } from "./api";
import type { WorkflowDefinition } from "./workflow-definition";

export const CONFIG_BUNDLE_FORMAT = "woofx3.config";
export const CONFIG_BUNDLE_VERSION = 1;

/** The parts of a configuration a bundle can carry. */
export const CONFIG_SECTIONS = ["workflows", "commands", "groups", "resources"] as const;
export type ConfigSection = (typeof CONFIG_SECTIONS)[number];

export interface ConfigExportOptions {
  /** Sections to export. Omitted exports every section. */
  include?: ConfigSection[];
  /**
   * Also export group members and the usernames a command is granted to.
   * Off by default: they are other people's usernames, and a bundle is made
   * to be shared.
   */
  includeMembers?: boolean;
}

/** A module the bundle's items reference, at the version it was exported from. */
export interface ConfigBundleRequirement {
  moduleId: string;
  version: string;
}

/**
 * A user-authored workflow. `definition` carries no id; `name` is its
 * identity and always equals `definition.name`.
 *
 * A sub-workflow task names the workflow it starts by id, which is not
 * portable, so the export blanks `workflow.workflowId` and records the target
 * by name in `workflowRefs` (task id to workflow name). Import resolves each
 * name to the id it has on the target engine.
 */
export interface ConfigBundleWorkflow {
  name: string;
  enabled: boolean;
  definition: Omit<WorkflowDefinition, "id">;
  workflowRefs: Record<string, string>;
  /** Module ids this workflow references. Each appears in the bundle's `requires`. */
  requires: string[];
}

/**
 * A user-authored chat command. Group grants are carried by group name, since
 * group ids differ per engine. `usernames` is present only in a bundle
 * exported with `includeMembers`.
 */
export interface ConfigBundleCommand {
  command: string;
  enabled: boolean;
  cooldown: number;
  priority: number;
  visibility: CommandVisibility;
  argumentPattern: string;
  actions: ActionStep[];
  groups: string[];
  usernames?: string[];
  requires: string[];
}

/**
 * A user-created command group. Built-in groups exist on every engine and are
 * never exported. `members` is present only with `includeMembers`.
 */
export interface ConfigBundleGroup {
  name: string;
  description: string;
  members?: string[];
}

/**
 * A module resource instance -- a counter, timer, queue, or any other kind a
 * module declares -- with the settings it was created with, not its current
 * value. Its identity is the canonical id `{module}:{kind}:{instanceId}`,
 * which is what workflows and widgets reference it by.
 */
export interface ConfigBundleResource {
  module: string;
  kind: string;
  instanceId: string;
  displayName: string;
  settings: Record<string, unknown>;
  requires: string[];
}

export interface ConfigBundle {
  format: typeof CONFIG_BUNDLE_FORMAT;
  version: typeof CONFIG_BUNDLE_VERSION;
  /** ISO 8601. */
  exportedAt: string;
  /** Release of the engine that made the bundle ("dev" for an unversioned build). */
  engineVersion: string;
  /** Whether group members and command usernames were exported. */
  includeMembers: boolean;
  requires: ConfigBundleRequirement[];
  workflows: ConfigBundleWorkflow[];
  commands: ConfigBundleCommand[];
  groups: ConfigBundleGroup[];
  resources: ConfigBundleResource[];
}

/**
 * What to do with a bundle item whose name is already taken on this engine by
 * something different:
 *
 * - `skip` keeps what is there and leaves the item unapplied.
 * - `rename` imports the item under a free name (`Name (imported)`,
 *   `word-imported`). A resource instance is referenced by its canonical id,
 *   so renaming it would break every workflow that uses it; a colliding
 *   resource stays a conflict instead.
 * - `overwrite` replaces what is there with the bundle's version.
 *
 * An item identical to what is already there is always skipped, whatever the
 * policy, which is what makes importing the same bundle twice harmless.
 */
export type ConfigConflictPolicy = "skip" | "rename" | "overwrite";

export interface ConfigImportOptions {
  /** Defaults to `skip`. */
  onConflict?: ConfigConflictPolicy;
  /** Sections to import. Omitted imports every section in the bundle. */
  include?: ConfigSection[];
  /**
   * Add the bundle's group members and per-user command grants. Off by
   * default: a bundle from someone else would otherwise hand their
   * usernames access to commands here. The plan names every username that
   * would be granted (`grants_access`) so the person can decide first.
   */
  applyMembers?: boolean;
}

export type ConfigItemKind = "workflow" | "command" | "group" | "resource";

/**
 * What import will do with an item:
 *
 * - `create`: add it, under `targetName` when that differs from the key.
 * - `update`: replace the existing item `targetId` with it.
 * - `skip`: nothing to do, the same item is already there.
 * - `conflict`: it will not be applied; `reasons` says why.
 */
export type ConfigImportAction = "create" | "update" | "skip" | "conflict";

export type ConfigImportReasonCode =
  /** The same item already exists. */
  | "identical"
  /** The name is taken by a different item. */
  | "name_collision"
  /** Every rename candidate is taken by a different item. */
  | "rename_exhausted"
  /** Imported under another name to avoid a collision. */
  | "renamed"
  /** The existing item will be replaced. */
  | "overwrite"
  /** The name belongs to something a module or the engine owns, which import never replaces. */
  | "not_owned"
  /** A module the item references is not installed. */
  | "missing_module"
  /** A module it references is installed at a different version than it was exported from. */
  | "module_version_mismatch"
  /** The module is installed but declares no such resource kind. */
  | "unknown_resource_kind"
  /** A workflow step names an action this engine has not registered. */
  | "unknown_action"
  /** A command is granted to a group that neither the bundle nor this engine has. */
  | "unknown_group"
  /** A sub-workflow step names a workflow that neither the bundle nor this engine has. */
  | "unknown_workflow"
  /** Something this item depends on (a group, a sub-workflow) will not be imported. */
  | "dependency_blocked"
  /** Applying the item grants these usernames access; see `applyMembers`. */
  | "grants_access"
  /** The bundle carries members or usernames that this import leaves out; see `applyMembers`. */
  | "members_not_applied"
  /** A step moderates chat, edits the stream or drives OBS. Worth reading before importing a shared bundle. */
  | "privileged_action"
  /** The item fails the same validation a save through the API applies. */
  | "invalid";

export interface ConfigImportReason {
  code: ConfigImportReasonCode;
  message: string;
  /** True when this reason alone keeps the item from being applied. */
  blocking: boolean;
}

export interface ConfigImportPlanItem {
  kind: ConfigItemKind;
  /** The item's identity in the bundle: name, command word, or canonical id. */
  key: string;
  action: ConfigImportAction;
  /** The name it will have on this engine; differs from `key` when renamed. */
  targetName: string;
  /** The existing item it matches, for `update` and `skip`. */
  targetId?: string;
  reasons: ConfigImportReason[];
}

export interface ConfigImportSummary {
  create: number;
  update: number;
  skip: number;
  conflict: number;
}

export interface ConfigImportPlan {
  onConflict: ConfigConflictPolicy;
  applyMembers: boolean;
  /** Groups first, then resources, workflows and commands: the order import applies them. */
  items: ConfigImportPlanItem[];
  summary: ConfigImportSummary;
  /** Modules the bundle requires that this engine does not have installed. */
  missingModules: ConfigBundleRequirement[];
}

export type ConfigImportOutcome = "created" | "updated" | "skipped" | "conflict" | "failed";

export interface ConfigImportResultItem {
  kind: ConfigItemKind;
  key: string;
  action: ConfigImportAction;
  outcome: ConfigImportOutcome;
  /** Name on this engine, for created and updated items. */
  name?: string;
  /** Id on this engine, for created, updated and skipped items. */
  id?: string;
  /** Why a `failed` item failed, or the first blocking reason of a `conflict`. */
  error?: string;
  /**
   * Set when the item was written but not completely: a workflow created but
   * not enabled, or a group created but missing members it should have.
   */
  warning?: string;
}

export interface ConfigImportResult {
  items: ConfigImportResultItem[];
  summary: Record<ConfigImportOutcome, number>;
}
