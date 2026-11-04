import {
  DEFAULT_MODERATION_CONFIG,
  isFilterId,
  MODERATION_ACTION_KINDS,
  MODERATION_ACTIONS_DEFAULT_LIMIT,
  MODERATION_ACTIONS_MAX_LIMIT,
  MODERATION_CONFIG_SETTING_KEY,
  MODERATION_STEP_OUTCOMES,
  MODERATION_SUBJECTS,
  type ModerationActionRecord,
  type ModerationActionTaken,
  type ModerationConfig,
  parseModerationConfig,
} from "@woofx3/api/moderation-config";
import { routeModule } from "./context";
import { toFrame } from "./stream-events";

/**
 * Chat moderation's config and log. The connectors host runs the config; the
 * api only stores it under MODERATION_CONFIG_SETTING_KEY, with the same parser
 * the host loads it with, and tells the host to reload.
 */
export const moderationRoutes = routeModule({
  async getModerationConfig(): Promise<ModerationConfig> {
    const stored = await this.db.getSetting(MODERATION_CONFIG_SETTING_KEY);
    if (stored === null || stored === "") {
      return DEFAULT_MODERATION_CONFIG;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(stored);
    } catch {
      this.logger.error("the stored moderation config is not JSON; answering the default");
      return DEFAULT_MODERATION_CONFIG;
    }
    const parsed = parseModerationConfig(raw);
    if (!parsed.ok) {
      this.logger.error("the stored moderation config is invalid; answering the default", { problem: parsed.error });
      return DEFAULT_MODERATION_CONFIG;
    }
    return parsed.value;
  },

  async setModerationConfig(config: ModerationConfig): Promise<ModerationConfig> {
    const parsed = parseModerationConfig(config);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    await this.db.setSetting(MODERATION_CONFIG_SETTING_KEY, JSON.stringify(parsed.value));
    // The host also reads the setting at start, so a lost notice only delays the change to its next start.
    await this.publishEvent(MODERATION_SUBJECTS.configUpdated, {});
    return parsed.value;
  },

  async listModerationActions(limit: number = MODERATION_ACTIONS_DEFAULT_LIMIT): Promise<ModerationActionRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MODERATION_ACTIONS_MAX_LIMIT) {
      throw new Error(`limit must be an integer from 1 to ${MODERATION_ACTIONS_MAX_LIMIT}`);
    }
    const page = await this.db.listRecentUserEvents({
      limit,
      skipTotal: true,
      eventTypes: [MODERATION_SUBJECTS.actionTaken],
    });
    const records: ModerationActionRecord[] = [];
    for (const event of page.events) {
      const frame = toFrame(event);
      if (!isActionTaken(frame.data)) {
        this.logger.warn("a logged moderation action is not in the shape the engine writes; left out", {
          eventId: event.eventId,
          source: event.source,
        });
        continue;
      }
      records.push({ ...frame.data, id: event.eventId, time: frame.time });
    }
    return records;
  },
});

/**
 * Whether a logged event's data is a `ModerationActionTaken`. The log keeps
 * whatever anything published on the subject, so it is checked before a
 * client gets it.
 */
function isActionTaken(data: unknown): data is ModerationActionTaken {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const value = data as Record<string, unknown>;
  const texts = ["platform", "viewer", "chatterLogin", "messageId", "reason", "text"] as const;
  return (
    texts.every((key) => typeof value[key] === "string") &&
    isFilterId(value.filter) &&
    typeof value.dryRun === "boolean" &&
    Array.isArray(value.steps) &&
    value.steps.every(
      (step: unknown) =>
        typeof step === "object" &&
        step !== null &&
        (MODERATION_ACTION_KINDS as readonly unknown[]).includes((step as Record<string, unknown>).kind) &&
        (MODERATION_STEP_OUTCOMES as readonly unknown[]).includes((step as Record<string, unknown>).outcome)
    )
  );
}
