import OBSWebSocket, { type OBSRequestTypes, type OBSResponseTypes } from "obs-websocket-js";
import type { TimerHandle, Timers } from "../../host/deps";
import type { ObsSession } from "./connection";

/** One OBS WebSocket session: what the engine's OBS control and listings ask OBS through. */
export default class Manager {
  constructor(private ws: OBSWebSocket) {}

  request<T extends keyof OBSRequestTypes>(cmd: T, args?: OBSRequestTypes[T]): Promise<OBSResponseTypes[T]> {
    return this.ws.call(cmd, args);
  }
}

/** What bounds one connect: a deadline, and the connection's end of life. */
export interface ObsConnectLimits {
  /** How long the WebSocket connect and sign-in may take (OBS_DEFAULTS.connectTimeoutMs). */
  connectTimeoutMs: number;
  timers: Timers;
  /** Aborted when the connection stops: the attempt ends and its timer is cleared at once. */
  signal: AbortSignal;
}

export interface ObsSessionTarget extends ObsConnectLimits {
  url: string;
  token?: string;
}

/**
 * Open one OBS WebSocket session, or throw. Retrying
 * is the caller's business (see `connection.ts`).
 *
 * The connect is raced against a timeout because obs-websocket-js does
 * not surface one for a stalled TCP handshake.
 */
export async function openObsSession(config: ObsSessionTarget): Promise<ObsSession<Manager>> {
  const ws = new OBSWebSocket();
  // Listened for from the start and latched: the socket can close before the
  // caller has registered anything, and a close nobody heard would leave a
  // dead session looking connected.
  let closed = false;
  let closeListener: (() => void) | null = null;
  ws.once("ConnectionClosed", () => {
    closed = true;
    closeListener?.();
  });
  let timer: TimerHandle | undefined;
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([
      ws.connect(config.url, config.token),
      new Promise((_, reject) => {
        timer = config.timers.setTimeout(
          () => reject(new Error(`timeout after ${config.connectTimeoutMs}ms`)),
          config.connectTimeoutMs
        );
        onAbort = () => reject(new Error("OBS connection stopped while opening"));
        if (config.signal.aborted) {
          onAbort();
        } else {
          config.signal.addEventListener("abort", onAbort, { once: true });
        }
      }),
    ]);
    return {
      client: new Manager(ws),
      onClose: (listener) => {
        if (closed) {
          queueMicrotask(listener);
          return;
        }
        closeListener = listener;
      },
      close: () => ws.disconnect(),
    };
  } catch (err) {
    // Not awaited: if the underlying connect is still hanging, awaiting
    // its teardown would hang too.
    void ws.disconnect().catch(() => undefined);
    throw err;
  } finally {
    config.timers.clearTimeout(timer);
    if (onAbort) {
      config.signal.removeEventListener("abort", onAbort);
    }
  }
}
