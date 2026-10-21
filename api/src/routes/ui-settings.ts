import type { UISetting, UISettingChanges, UISettingValue, UISettingWriteResult } from "@woofx3/api";
import type * as local_ui_setting from "@woofx3/db/local_ui_setting.pb";
import { routeModule } from "./context";
import { timestampToIso } from "./helpers";

/**
 * The dashboard's own data, kept by db-proxy in `local_ui_settings`
 * (docs/services/local-ui-settings.md). db-proxy owns the rules: the length
 * limits, the value cap and the revision checks. This layer only turns the
 * caller's arguments into its request and its rows into `UISetting`s, and
 * refuses what cannot be sent at all.
 */

function requireText(name: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return value;
}

function optionalRevision(name: string, value: unknown): bigint | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return BigInt(nonNegativeInteger(name, value));
}

function nonNegativeInteger(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

/**
 * JSON text for a value, or an error for one JSON cannot represent. capnweb
 * delivers `undefined`, a bigint and a cyclic object too; `JSON.stringify`
 * drops the first and throws on the others, and none of them may be stored as
 * something else.
 */
function encodeValue(value: unknown): string {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch (err) {
    throw new Error(`value is not representable as JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (encoded === undefined) {
    throw new Error("value is not representable as JSON");
  }
  return encoded;
}

/** Revisions are int64 in db-proxy; a count of writes stays far below 2^53. */
function revisionNumber(revision: bigint): number {
  const value = Number(revision);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`local ui setting revision ${revision} exceeds the safe integer range`);
  }
  return value;
}

export function toUISetting(row: local_ui_setting.LocalUISetting): UISetting {
  return {
    namespace: row.namespace,
    key: row.key,
    value: row.deleted ? null : (JSON.parse(row.valueJson) as UISettingValue),
    revision: revisionNumber(row.revision),
    updatedAt: timestampToIso(row.updatedAt),
    deleted: row.deleted,
  };
}

function toWriteResult(response: local_ui_setting.WriteLocalUISettingResponse): UISettingWriteResult {
  if (response.conflict) {
    return { ok: false, reason: "conflict", current: response.setting ? toUISetting(response.setting) : null };
  }
  if (!response.setting) {
    throw new Error("db-proxy wrote a local ui setting but returned no row");
  }
  return { ok: true, setting: toUISetting(response.setting) };
}

export const uiSettingsRoutes = routeModule({
  async listUISettings(namespace: string): Promise<UISetting[]> {
    const rows = await this.db.listLocalUISettings(requireText("namespace", namespace));
    return rows.map(toUISetting);
  },

  async getUISetting(namespace: string, key: string): Promise<UISetting | null> {
    const row = await this.db.findLocalUISetting(requireText("namespace", namespace), requireText("key", key));
    return row === null ? null : toUISetting(row);
  },

  async setUISetting(
    namespace: string,
    key: string,
    value: UISettingValue,
    expectedRevision?: number
  ): Promise<UISettingWriteResult> {
    const response = await this.db.setLocalUISetting({
      namespace: requireText("namespace", namespace),
      key: requireText("key", key),
      valueJson: encodeValue(value),
      expectedRevision: optionalRevision("expectedRevision", expectedRevision),
    });
    const result = toWriteResult(response);
    if (result.ok) {
      void this.emitUISettingWebhook(result.setting);
    }
    return result;
  },

  async deleteUISetting(namespace: string, key: string, expectedRevision?: number): Promise<UISettingWriteResult> {
    const response = await this.db.deleteLocalUISetting({
      namespace: requireText("namespace", namespace),
      key: requireText("key", key),
      expectedRevision: optionalRevision("expectedRevision", expectedRevision),
    });
    const result = toWriteResult(response);
    if (result.ok) {
      void this.emitUISettingWebhook(result.setting);
    }
    return result;
  },

  async listUISettingChangesSince(revision: number, limit?: number): Promise<UISettingChanges> {
    const page = await this.db.listLocalUISettingChanges({
      afterRevision: BigInt(nonNegativeInteger("revision", revision)),
      // 0 asks db-proxy for its default page size.
      limit: limit === undefined ? 0 : nonNegativeInteger("limit", limit),
    });
    return { changes: page.settings.map(toUISetting), hasMore: page.hasMore };
  },
});
