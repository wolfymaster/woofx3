// The route policy for module requests: module code reaching one of its own
// declared local endpoints through `ctx.local`. Module code sends arbitrary
// frames, so this policy fails closed where the adapter policy is
// best-effort: no configuration fallback, no address outside the streamer's
// network, and no direct route at all where the engine's hosting does not
// put it on that network.

import type { EngineHosting } from "@woofx3/api";
import { errorMessage } from "../host/deps";
import { type ClaimRegistry, endpointKey } from "./claims";
import type { EndpointStore, StoredModuleSetting } from "./endpoint-store";
import { type DeclaredEndpoint, declaredEndpoint } from "./endpoints";
import { checkLocalAddress, type NameResolver } from "./local-address";
import { type DirectDecision, type RoutePolicy, urlHost, validPort } from "./route-policy";
import type { EndpointUnavailable, EndpointUnavailableReason, LocalEndpointRef } from "./types";

export interface ModulePolicyDeps {
  store: EndpointStore;
  claims: Pick<ClaimRegistry, "ownerOf">;
  hosting: EngineHosting | null;
  /** `WOOFX3_MODULE_LOCAL_DIRECT`: a `self` engine may dial direct addresses. */
  localDirect: boolean;
  resolver: NameResolver;
}

/** The endpoint a module may reach, or why it may not. */
export type Admission = { ok: true; endpoint: DeclaredEndpoint } | EndpointUnavailable;

export interface ModuleRoutePolicy extends RoutePolicy {
  /**
   * Whether module code may reach the endpoint at all, whatever the route:
   * unclaimed, declared in the installed manifest, and a websocket. Reads the
   * manifest afresh.
   */
  admit(ref: LocalEndpointRef): Promise<Admission>;
}

export function modulePolicy(deps: ModulePolicyDeps): ModuleRoutePolicy {
  const admit = async (ref: LocalEndpointRef): Promise<Admission> => {
    const owner = deps.claims.ownerOf(ref);
    if (owner !== null) {
      return unavailable(
        "adapter_owned",
        `${endpointKey(ref)} is reached through the ${owner} adapter; module code cannot open it`
      );
    }
    let manifest: string | null;
    try {
      manifest = await deps.store.moduleManifest(ref.moduleId);
    } catch (error) {
      return unavailable("store_unreadable", `${ref.moduleId}'s manifest could not be read: ${errorMessage(error)}`);
    }
    const endpoint = declaredEndpoint(manifest, ref);
    if (endpoint === null) {
      return unavailable("not_declared", `${ref.moduleId} declares no local endpoint "${ref.endpointId}"`);
    }
    if (endpoint.protocol !== "websocket") {
      return unavailable("protocol_unsupported", "http endpoints are not supported yet");
    }
    return { ok: true, endpoint };
  };

  return {
    directWithoutRelayConfig: false,
    admit,
    direct: async (ref) => {
      const admission = await admit(ref);
      if (!admission.ok) {
        return admission;
      }
      const notRouted = directRefusal(deps.hosting, deps.localDirect);
      if (notRouted !== null) {
        return notRouted;
      }
      let settings: StoredModuleSetting[];
      try {
        settings = await deps.store.moduleSettings(ref.moduleId);
      } catch (error) {
        return unavailable("store_unreadable", `${ref.moduleId} settings could not be read: ${errorMessage(error)}`);
      }
      // Only the stored settings name the address: never connectors' own
      // configuration, and never the password, which is the module's protocol business.
      const value = (key: string) => settings.find((setting) => setting.key === key)?.value.trim() ?? "";
      const host = value(admission.endpoint.hostSetting);
      const port = validPort(value(admission.endpoint.portSetting));
      if (host === "" || port === null) {
        return unavailable("not_routed", "no address is set for this endpoint");
      }
      const checked = await checkLocalAddress(host, deps.hosting, deps.resolver);
      if (!checked.ok) {
        return unavailable("address_refused", checked.reason);
      }
      return {
        ok: true,
        route: "direct",
        url: `ws://${urlHost(checked.dialIp)}:${port}`,
        address: `${urlHost(host)}:${port}`,
      } satisfies DirectDecision;
    },
  };
}

/** Why the engine's hosting allows module requests no direct route, or null when it does. */
function directRefusal(hosting: EngineHosting | null, localDirect: boolean): EndpointUnavailable | null {
  if (hosting === "local") {
    return null;
  }
  if (hosting === "self") {
    return localDirect
      ? null
      : unavailable(
          "not_routed",
          "turn on the companion for this endpoint, or set WOOFX3_MODULE_LOCAL_DIRECT=true to let this engine dial it directly"
        );
  }
  return unavailable("not_routed", "turn on the companion for this endpoint");
}

function unavailable(reason: EndpointUnavailableReason, message: string): EndpointUnavailable {
  return { ok: false, reason, message };
}
