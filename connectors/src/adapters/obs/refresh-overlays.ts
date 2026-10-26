// Server-initiated overlay recovery.
//
// A browser can only be told something over a connection that already
// exists, which is exactly what's missing after sceneManager restarts
// -- so there is no way for the server to notify "previous
// connections" directly, and no client registry would help. But OBS is
// already holding the durable list of who has the overlay open: its
// browser sources persist across sceneManager's lifetime and survive
// its restarts. OBS *is* the registry.
//
// So when sceneManager asks for a refresh (see service.ts), the obs adapter
// walks OBS's inputs, finds the browser sources pointed at sceneManager's
// overlay routes, and refreshes them. Those overlays come back immediately
// instead of waiting out a backoff. The client-side reconnect loop
// (sceneManager/public/scene-manager/event-source.ts) remains the fallback for
// every case this can't cover: OBS not running, OBS started after
// sceneManager, a scene open in a plain browser tab, or a drop that isn't a
// restart.

import { BROWSER_SOURCE_KIND } from "@woofx3/common/cloudevents/Obs/commands";
import type { Logger } from "../../host/deps";
import { isNotFound, isObsRefusal, type ObsControlOptions, ObsTimeoutError, withDeadline } from "./control";

const REFRESH_BUTTON = "refreshnocache";

/** The slice of `manager.ts` this needs. Keeping it structural
 *  means the refresh logic is testable without an OBS connection. */
export interface ObsRequester {
  request(cmd: "GetInputList", args: Record<string, never>): Promise<{ inputs: unknown[] }>;
  request(cmd: "GetInputSettings", args: { inputName: string }): Promise<{ inputSettings: Record<string, unknown> }>;
  request(cmd: "PressInputPropertiesButton", args: { inputName: string; propertyName: string }): Promise<unknown>;
}

/**
 * Whether a browser source's URL points at one of our overlay routes.
 *
 * Matched on port plus the `/scene/` path prefix, deliberately not on
 * host: the configured bind host is routinely `0.0.0.0`, while the URL
 * a user typed into OBS is `localhost`, `127.0.0.1`, or the machine's
 * LAN name -- all of which reach us and none of which equal the bind
 * host. Port and path are what actually identify the route.
 */
export function isOverlayUrl(rawUrl: unknown, port: number): boolean {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  const urlPort = parsed.port !== "" ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  if (urlPort !== port) {
    return false;
  }
  return parsed.pathname === "/scene" || parsed.pathname.startsWith("/scene/");
}

interface ObsInput {
  inputName?: unknown;
  inputKind?: unknown;
}

/**
 * Refreshes every OBS browser source pointing at sceneManager's overlays on `port`.
 * Never throws. An input disappearing mid-walk is skipped and a refusal to
 * press the button is logged. Returns how many sources were refreshed, or
 * null when OBS could not be asked (no session, the session failed mid-walk,
 * or a request outlived `options.timeoutMs`), so a caller can try again on a
 * later session. Each request is bounded because obs-websocket-js never
 * settles a request whose session closed before the reply arrived; unbounded,
 * one lost reply would hold the latched request for the life of the process.
 */
export async function refreshOverlayBrowserSources(
  obs: ObsRequester | null,
  port: number,
  logger: Logger,
  options: ObsControlOptions
): Promise<number | null> {
  if (!obs) {
    return null;
  }
  const bounded = <T>(work: Promise<T>): Promise<T> => withDeadline(work, options.timeoutMs, options.timers);
  const notAsked = (step: string, err: unknown): null => {
    if (err instanceof ObsTimeoutError) {
      options.onTimeout?.();
    }
    logger.warn(`OBS ${step} failed; overlay refresh waits for the next session`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  };

  let inputs: unknown[];
  try {
    const result = await bounded(obs.request("GetInputList", {} as Record<string, never>));
    inputs = Array.isArray(result.inputs) ? result.inputs : [];
  } catch (err) {
    return notAsked("input list", err);
  }

  const names: string[] = [];
  for (const raw of inputs) {
    const input = raw as ObsInput;
    if (input.inputKind !== BROWSER_SOURCE_KIND || typeof input.inputName !== "string") {
      continue;
    }
    try {
      const { inputSettings } = await bounded(obs.request("GetInputSettings", { inputName: input.inputName }));
      if (isOverlayUrl(inputSettings?.url, port)) {
        names.push(input.inputName);
      }
    } catch (err) {
      // An input removed between listing and reading simply isn't a
      // refresh candidate; any other failure means the walk saw nothing.
      if (!isNotFound(err)) {
        return notAsked("input settings", err);
      }
    }
  }

  let refreshed = 0;
  for (const inputName of names) {
    try {
      await bounded(obs.request("PressInputPropertiesButton", { inputName, propertyName: REFRESH_BUTTON }));
      refreshed += 1;
    } catch (err) {
      if (!isObsRefusal(err)) {
        return notAsked("browser source refresh", err);
      }
      if (!isNotFound(err)) {
        logger.warn("OBS browser source refresh failed", {
          inputName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (refreshed > 0) {
    logger.info("Refreshed OBS overlay browser sources", { count: refreshed, inputs: names });
  }
  return refreshed;
}
