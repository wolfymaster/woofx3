// Asks, over the bus, for the OBS browser sources showing this process's
// overlays to be refreshed -- once per start, after the HTTP server listens.
//
// The asker and the holder of the OBS connection are different processes
// that start in no particular order, and the holder can restart or have OBS
// stopped, so a single request could be lost. It is therefore repeated with
// capped, jittered backoff until a reply accepts it, and only shutdown ends
// the retrying. Answering is idempotent per boot id (see
// `ObsBrowserSourceRefresh`), so repeats are harmless.

import {
  OBS_BROWSER_SOURCE_REFRESH_SUBJECT,
  type ObsBrowserSourceRefresh,
  parseObsBrowserSourceRefreshReply,
} from "@woofx3/common/cloudevents/Obs/commands";
import { createBackoff, type Logger, type RandomSource } from "@woofx3/common/runtime";
import type NATSClient from "@woofx3/nats/src/client";
import type { ObsRefreshConfig } from "../config";

export interface RefreshRequestTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface RefreshRequestDeps {
  bus: Pick<NATSClient, "request">;
  config: ObsRefreshConfig;
  random: RandomSource;
  timers: RefreshRequestTimers;
  logger: Logger;
}

export interface RefreshRequester {
  /** Ends the retrying and resolves once any attempt in flight has finished. */
  stop(): Promise<void>;
}

export const systemRefreshTimers: RefreshRequestTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Starts requesting in the background; the request is repeated until accepted or `stop()`. */
export function startRefreshRequests(request: ObsBrowserSourceRefresh, deps: RefreshRequestDeps): RefreshRequester {
  const { bus, config, timers, logger } = deps;
  const backoff = createBackoff({ baseMs: config.retryBaseMs, maxMs: config.retryMaxMs }, deps.random);
  const body = new TextEncoder().encode(JSON.stringify(request));
  let stopped = false;
  let wake: (() => void) | null = null;
  let warned = false;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const handle = timers.set(() => {
        wake = null;
        resolve();
      }, ms);
      wake = () => {
        timers.clear(handle);
        wake = null;
        resolve();
      };
    });

  const run = async () => {
    for (let attempt = 1; !stopped; attempt += 1) {
      const outcome = await attemptOnce(bus, body, request.bootId, config.requestTimeoutMs);
      if (stopped) {
        return;
      }
      if (outcome.accepted) {
        backoff.reset();
        logger.info("OBS overlay refresh requested", { bootId: request.bootId, attempts: attempt });
        return;
      }
      logger.debug("OBS overlay refresh not accepted; retrying", { attempt, reason: outcome.reason });
      if (!warned && config.retryBaseMs * 2 ** (attempt - 1) >= config.retryMaxMs) {
        warned = true;
        logger.warn("OBS overlay refresh still not accepted; retrying in the background", {
          attempts: attempt,
          reason: outcome.reason,
        });
      }
      await sleep(backoff.next());
    }
  };
  const running = run();

  return {
    async stop() {
      stopped = true;
      wake?.();
      await running;
    },
  };
}

type Attempt = { accepted: true } | { accepted: false; reason: string };

async function attemptOnce(
  bus: Pick<NATSClient, "request">,
  body: Uint8Array,
  bootId: string,
  timeoutMs: number
): Promise<Attempt> {
  let data: Uint8Array;
  try {
    ({ data } = await bus.request(OBS_BROWSER_SOURCE_REFRESH_SUBJECT, body, { timeout: timeoutMs }));
  } catch (err) {
    return { accepted: false, reason: err instanceof Error ? err.message : String(err) };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(data));
  } catch {
    return { accepted: false, reason: "the reply is not JSON" };
  }
  const reply = parseObsBrowserSourceRefreshReply(raw);
  if (!reply.ok) {
    return { accepted: false, reason: reply.error };
  }
  if (reply.value.status === "invalid") {
    return { accepted: false, reason: `refused as invalid: ${reply.value.error}` };
  }
  if (reply.value.status === "unavailable") {
    return { accepted: false, reason: `the OBS adapter could not take it yet: ${reply.value.error}` };
  }
  if (reply.value.bootId !== bootId) {
    return { accepted: false, reason: "the reply answers another boot id" };
  }
  return { accepted: true };
}
