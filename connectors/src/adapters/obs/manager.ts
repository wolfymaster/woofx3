import OBSWebSocket, { type OBSRequestTypes, type OBSResponseTypes } from "obs-websocket-js";
import type { ObsSession } from "./connection";

/** One OBS WebSocket session: what the engine's OBS control and listings ask OBS through. */
export default class Manager {
  constructor(private ws: OBSWebSocket) {}

  request<T extends keyof OBSRequestTypes>(cmd: T, args?: OBSRequestTypes[T]): Promise<OBSResponseTypes[T]> {
    return this.ws.call(cmd, args);
  }
}

const OBS_CONNECT_TIMEOUT_MS = 3_000;

/**
 * Open one OBS WebSocket session, or throw. Retrying
 * is the caller's business (see `connection.ts`).
 *
 * The connect is raced against a timeout because obs-websocket-js does
 * not surface one for a stalled TCP handshake.
 */
export async function openObsSession(config: { url: string; token?: string }): Promise<ObsSession<Manager>> {
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ws.connect(config.url, config.token),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timeout after ${OBS_CONNECT_TIMEOUT_MS}ms`)),
          OBS_CONNECT_TIMEOUT_MS
        );
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
    clearTimeout(timer);
  }
}
