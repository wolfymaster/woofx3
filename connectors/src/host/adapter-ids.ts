/**
 * Every adapter the host knows by name. Separate from IntegrationId
 * (@woofx3/common/integrations/integration-settings): an integration is an
 * account-backed credential the api stores, while an adapter is anything the
 * host runs. A local adapter joins this list without becoming an integration.
 */
export const ADAPTER_IDS = ["twitch", "obs"] as const;

export type AdapterId = (typeof ADAPTER_IDS)[number];

export function isAdapterId(value: unknown): value is AdapterId {
  return ADAPTER_IDS.some((id) => id === value);
}
