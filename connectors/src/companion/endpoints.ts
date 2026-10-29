// Reads a module's declared local endpoints from its stored manifest.

import { isEndpointId, isModuleId } from "@woofx3/common/cloudevents/Relay/relay";
import type { EndpointKeys, EndpointProtocol, LocalEndpointRef } from "./types";

/** One `local[]` entry as barkloader validated and stored it (lib_module LocalEndpoint). */
export interface DeclaredEndpoint extends EndpointKeys {
  id: string;
  name: string;
  protocol: EndpointProtocol;
}

const PROTOCOLS: readonly EndpointProtocol[] = ["websocket", "http"];

/** True when both ids are ones the relay accepts as bridge path segments. */
export function isLocalEndpointRef(value: unknown): value is LocalEndpointRef {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { moduleId, endpointId } = value as { moduleId?: unknown; endpointId?: unknown };
  return (
    typeof moduleId === "string" && isModuleId(moduleId) && typeof endpointId === "string" && isEndpointId(endpointId)
  );
}

/**
 * The `local[]` entry for `ref` in a stored manifest (`modules.manifest`, as
 * barkloader re-serialized it at install), or null. Null also covers a ref
 * whose ids are not valid, a manifest that cannot be read, and an entry
 * missing a field barkloader requires, so a module installed before
 * `local[]` existed reads as declaring nothing.
 */
export function declaredEndpoint(manifest: string | null | undefined, ref: LocalEndpointRef): DeclaredEndpoint | null {
  if (!isLocalEndpointRef(ref) || !manifest) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest);
  } catch {
    return null;
  }
  const local = (parsed as { local?: unknown } | null)?.local;
  if (!Array.isArray(local)) {
    return null;
  }
  const entry = local.find((e) => (e as { id?: unknown } | null)?.id === ref.endpointId) as
    | Record<string, unknown>
    | undefined;
  if (entry === undefined) {
    return null;
  }
  const { name, protocol, hostSetting, portSetting, passwordSetting } = entry;
  if (
    typeof name !== "string" ||
    typeof hostSetting !== "string" ||
    typeof portSetting !== "string" ||
    !PROTOCOLS.some((known) => known === protocol)
  ) {
    return null;
  }
  const declared: DeclaredEndpoint = {
    id: ref.endpointId,
    name,
    protocol: protocol as EndpointProtocol,
    hostSetting,
    portSetting,
  };
  if (typeof passwordSetting === "string") {
    declared.passwordSetting = passwordSetting;
  }
  return declared;
}
