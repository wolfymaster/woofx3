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
// So on startup we walk OBS's inputs, find the browser sources pointed
// at our own overlay routes, and refresh them. Those overlays come back
// immediately instead of waiting out a backoff. The client-side
// reconnect loop (public/scene-manager/event-source.ts) remains the
// fallback for every case this can't cover: OBS not running, OBS
// started after us, a scene open in a plain browser tab, or a drop that
// isn't a restart.

import type { Logger } from "@woofx3/common/runtime";

const BROWSER_SOURCE_KIND = "browser_source";
const REFRESH_BUTTON = "refreshnocache";

/** The slice of `obs/manager.ts` this needs. Keeping it structural
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
 * Refreshes every OBS browser source pointing at this sceneManager.
 * Best-effort throughout: OBS being absent, an input disappearing
 * mid-walk, or a refusal to press the button must never keep
 * sceneManager from starting. Returns how many sources were refreshed.
 */
export async function refreshOverlayBrowserSources(
  obs: ObsRequester | null,
  port: number,
  logger: Logger,
): Promise<number> {
  if (!obs) {
    return 0;
  }

  let inputs: unknown[];
  try {
    const result = await obs.request("GetInputList", {} as Record<string, never>);
    inputs = Array.isArray(result.inputs) ? result.inputs : [];
  } catch (err) {
    logger.warn("OBS input list unavailable; skipping overlay refresh", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }

  const names: string[] = [];
  for (const raw of inputs) {
    const input = raw as ObsInput;
    if (input.inputKind !== BROWSER_SOURCE_KIND || typeof input.inputName !== "string") {
      continue;
    }
    try {
      const { inputSettings } = await obs.request("GetInputSettings", { inputName: input.inputName });
      if (isOverlayUrl(inputSettings?.url, port)) {
        names.push(input.inputName);
      }
    } catch {
      // Input vanished or is unreadable between listing and reading --
      // it simply isn't a refresh candidate.
    }
  }

  let refreshed = 0;
  for (const inputName of names) {
    try {
      await obs.request("PressInputPropertiesButton", { inputName, propertyName: REFRESH_BUTTON });
      refreshed += 1;
    } catch (err) {
      logger.warn("OBS browser source refresh failed", {
        inputName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (refreshed > 0) {
    logger.info("Refreshed OBS overlay browser sources after startup", { count: refreshed, inputs: names });
  }
  return refreshed;
}
