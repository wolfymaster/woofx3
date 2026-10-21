// Whether an account-backed integration should run, recorded apart from
// whether it is linked. "Connected" is a non-empty credential; "enabled" is
// the setting below. The api writes it, the connectors host reads it, and an
// adapter runs while it is connected AND enabled. See docs/services/twitch-channel.md.

/** Integrations backed by account credentials. Local adapters such as obs are not integrations and never appear here. */
export const INTEGRATION_IDS = ["twitch"] as const;

export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export function isIntegrationId(value: unknown): value is IntegrationId {
  return INTEGRATION_IDS.some((id) => id === value);
}

/** Engine setting holding "true" or "false" for one integration. */
export function integrationEnabledSettingKey(id: IntegrationId): string {
  return `integration.${id}.enabled`;
}

/** Published by the api whenever an integration's enabled setting is written. Payload: `IntegrationEnabledUpdated`. */
export const INTEGRATION_ENABLED_UPDATED_SUBJECT = "setting.integration.enabled.updated";

/** Published only by the api whenever an integration's credential changes. Payload: `IntegrationTokenUpdated`. */
export const INTEGRATION_TOKEN_UPDATED_SUBJECT = "setting.integration.token.updated";

export type IntegrationEnabledUpdated = { integration: IntegrationId; enabled: boolean };

export type IntegrationTokenUpdated = { integration: IntegrationId };

/** Ties each integration subject to its payload type. */
export type IntegrationEventPayloads = {
  [INTEGRATION_ENABLED_UPDATED_SUBJECT]: IntegrationEnabledUpdated;
  [INTEGRATION_TOKEN_UPDATED_SUBJECT]: IntegrationTokenUpdated;
};

export type IntegrationEnabled =
  | { kind: "set"; enabled: boolean }
  | { kind: "absent" }
  | { kind: "invalid"; raw: string };

/** A stored value, read strictly: only "true" and "false" are a decision. */
export function parseIntegrationEnabled(raw: string | null): IntegrationEnabled {
  if (raw === null || raw === "") {
    return { kind: "absent" };
  }
  if (raw === "true") {
    return { kind: "set", enabled: true };
  }
  if (raw === "false") {
    return { kind: "set", enabled: false };
  }
  return { kind: "invalid", raw };
}

/**
 * Whether the integration should run. With no usable decision it follows
 * `connected`, so an account linked before the setting existed keeps running.
 * Callers log `invalid`; this stays pure.
 */
export function resolveEnabled(parsed: IntegrationEnabled, connected: boolean): boolean {
  if (parsed.kind === "set") {
    return parsed.enabled;
  }
  return connected;
}
