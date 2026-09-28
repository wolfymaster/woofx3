import type {
  ConfigBundle,
  ConfigExportOptions,
  ConfigImportOptions,
  ConfigImportPlan,
  ConfigImportResult,
} from "@woofx3/api";
import { applyImport, type ConfigWriter } from "../config-bundle/apply";
import { buildConfigBundle } from "../config-bundle/export";
import { planImport } from "../config-bundle/plan";
import { parseConfigBundle, parseConflictPolicy, parseSections } from "../config-bundle/schema";
import { readEngineConfig } from "../config-bundle/state";
import { routeModule } from "./context";

function parseExportOptions(options: unknown): ConfigExportOptions {
  if (options === undefined || options === null) {
    return {};
  }
  if (typeof options !== "object" || Array.isArray(options)) {
    throw new Error("exportConfig: options must be an object");
  }
  const { includeMembers } = options as ConfigExportOptions;
  if (includeMembers !== undefined && typeof includeMembers !== "boolean") {
    throw new Error("exportConfig: includeMembers must be a boolean");
  }
  return options as ConfigExportOptions;
}

function parseImportOptions(options: unknown): ConfigImportOptions {
  if (options === undefined || options === null) {
    return {};
  }
  if (typeof options !== "object" || Array.isArray(options)) {
    throw new Error("options must be an object");
  }
  return options as ConfigImportOptions;
}

/**
 * Back up, move and share a creator's configuration. See
 * docs/services/config-bundles.md for the format and the import rules.
 */
export const configBundlesRoutes = routeModule({
  async exportConfig(options?: ConfigExportOptions): Promise<ConfigBundle> {
    const { include, includeMembers = false } = parseExportOptions(options);
    const sections = parseSections(include);
    const state = await readEngineConfig(this.db, { members: includeMembers && sections.has("groups") });
    const bundle = buildConfigBundle(state, {
      sections,
      includeMembers,
      engineVersion: this.version,
      now: new Date(),
    });
    this.logger.info("Exported config bundle", {
      workflows: bundle.workflows.length,
      commands: bundle.commands.length,
      groups: bundle.groups.length,
      resources: bundle.resources.length,
    });
    return bundle;
  },

  async previewImport(bundle: unknown, options?: ConfigImportOptions): Promise<ConfigImportPlan> {
    const parsed = parseConfigBundle(bundle);
    const { include, onConflict } = parseImportOptions(options);
    const sections = parseSections(include);
    const policy = parseConflictPolicy(onConflict);
    const state = await readEngineConfig(this.db, { members: parsed.includeMembers });
    return planImport(parsed, state, { policy, sections }).plan;
  },

  /**
   * Plans against the engine's state at the moment of the call rather than
   * accepting a plan from the caller: a preview may be minutes old, and a
   * plan the client could edit would let it choose what to overwrite.
   */
  async importConfig(
    bundle: unknown,
    options: ConfigImportOptions | undefined,
    context: { clientId: string }
  ): Promise<ConfigImportResult> {
    const parsed = parseConfigBundle(bundle);
    const { include, onConflict } = parseImportOptions(options);
    const sections = parseSections(include);
    const policy = parseConflictPolicy(onConflict);
    const state = await readEngineConfig(this.db, { members: parsed.includeMembers });
    const { steps } = planImport(parsed, state, { policy, sections });

    // Route modules are typed against the host alone (see routeModule), but
    // at runtime `this` is the Api carrying every registered route; these are
    // the ones import writes through.
    const writer = this as unknown as ConfigWriter;
    const result = await applyImport(steps, state, writer, context);
    this.logger.info("Imported config bundle", { onConflict: policy, ...result.summary });
    return result;
  },
});
