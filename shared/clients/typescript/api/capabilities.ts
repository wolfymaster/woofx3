import type { EngineHosting } from "./api";

/**
 * Engine capability ids: the features this engine build supports that a
 * client may need to detect before using. `getEngineCapabilities()` returns
 * exactly these values, so an id listed here is a promise the engine keeps.
 *
 * A client asks for this list rather than comparing `getEngineInfo().version`
 * against the release that shipped a feature: a build from source reports
 * `dev`, and a list keeps clients from tracking which release shipped what.
 * The capability table in docs/services/engine-capabilities.md records each
 * id's first release (its Since column) only so a client knows when every
 * supported engine has the id and its check can be removed.
 *
 * An id is `<area>.<feature>` in camelCase and never changes meaning once
 * shipped: a behavior change that clients must tell apart gets a new id.
 * Every id must also be listed in docs/services/engine-capabilities.md.
 */
export const ENGINE_CAPABILITIES = {
  /**
   * This engine runs on the streamer's own machine under the desktop app
   * (`getEngineInfo().hosting` is `local`). Advertised only by such an engine;
   * see HOSTING_ENGINE_CAPABILITIES.
   */
  engineLocalMode: "engine.localMode",
  /**
   * Browser pairing (./pairing.ts): the gateway's `startPairing`,
   * `claimPairing` and `cancelPairing`, `ping().pairing`, an approver's
   * `lookupPairing`, `decidePairing` and `listPendingPairings`, the
   * `client.pairing.started` event, and paired clients bound to their origin.
   * Advertised only by a local or self-hosted engine; see
   * HOSTING_ENGINE_CAPABILITIES.
   */
  clientsPairing: "clients.pairing",
} as const;

export type EngineCapability = (typeof ENGINE_CAPABILITIES)[keyof typeof ENGINE_CAPABILITIES];

/**
 * Version of the `EngineCapabilities` response shape itself, not of the
 * engine. It changes only if the response stops being a flat id list.
 */
export const ENGINE_CAPABILITIES_SCHEMA = 1;

/**
 * Returned by `getEngineCapabilities()`. `capabilities` is sorted and
 * unique. It is typed `string[]` rather than `EngineCapability[]` because a
 * client built against an older contract must tolerate ids it does not know.
 */
export interface EngineCapabilities {
  schema: typeof ENGINE_CAPABILITIES_SCHEMA;
  capabilities: string[];
}

/**
 * Ids declared here that this build does not advertise, so clients can name
 * them before or after the engine supports them: a shared contract that lands
 * before the engine implements it, or an older protocol the engine no longer
 * serves. None today.
 */
export const UNADVERTISED_ENGINE_CAPABILITIES: ReadonlySet<EngineCapability> = new Set<EngineCapability>([]);

/**
 * Ids that describe how an engine is run rather than what its build can do,
 * each advertised only by an engine whose deployment declares one of the
 * listed hostings (`EngineInfo.hosting`).
 */
export const HOSTING_ENGINE_CAPABILITIES: ReadonlyMap<EngineCapability, readonly EngineHosting[]> = new Map<
  EngineCapability,
  readonly EngineHosting[]
>([
  [ENGINE_CAPABILITIES.engineLocalMode, ["local"]],
  [ENGINE_CAPABILITIES.clientsPairing, ["local", "self"]],
]);

/** Whether an engine with `hosting` offers browser pairing: whether it advertises `clients.pairing`. */
export function hostingOffersPairing(hosting: EngineHosting | null): boolean {
  return supportedEngineCapabilities(hosting).includes(ENGINE_CAPABILITIES.clientsPairing);
}

/**
 * The capability ids this engine advertises, sorted and unique: every id its
 * build supports, plus the ids for `hosting` when the deployment declares one.
 */
export function supportedEngineCapabilities(hosting: EngineHosting | null = null): EngineCapability[] {
  return [...new Set(Object.values(ENGINE_CAPABILITIES))]
    .filter((id) => !UNADVERTISED_ENGINE_CAPABILITIES.has(id))
    .filter((id) => {
      const required = HOSTING_ENGINE_CAPABILITIES.get(id);
      return required === undefined || (hosting !== null && required.includes(hosting));
    })
    .sort();
}

/**
 * A `getEngineCapabilities()` answer as read by a client: every id listed,
 * sorted and unique, including ids this contract does not declare (a newer
 * engine lists features an older client has never heard of). Entries that
 * are not strings, and empty strings, are dropped.
 *
 * Throws on an answer that is not the schema-1 shape. A different `schema`
 * means the answer is no longer a flat id list, and guessing at it could
 * offer a feature the engine does not have.
 */
export function parseEngineCapabilities(raw: unknown): EngineCapabilities {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Engine answered getEngineCapabilities with ${JSON.stringify(raw) ?? String(raw)}`);
  }
  const body = raw as { schema?: unknown; capabilities?: unknown };
  if (body.schema !== ENGINE_CAPABILITIES_SCHEMA) {
    throw new Error(
      `Engine answered getEngineCapabilities with schema ${JSON.stringify(body.schema) ?? "undefined"}; this client reads schema ${ENGINE_CAPABILITIES_SCHEMA}`
    );
  }
  if (!Array.isArray(body.capabilities)) {
    throw new Error("Engine answered getEngineCapabilities without a capabilities list");
  }
  const ids = new Set<string>();
  for (const id of body.capabilities) {
    if (typeof id === "string" && id !== "") {
      ids.add(id);
    }
  }
  return { schema: ENGINE_CAPABILITIES_SCHEMA, capabilities: [...ids].sort() };
}
