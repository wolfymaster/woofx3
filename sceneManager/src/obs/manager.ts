import type { Logger } from "@woofx3/common/runtime";
import OBSWebSocket, { type OBSRequestTypes, type OBSResponseTypes } from "obs-websocket-js";
import type { ObsSession } from "./connection";
import Scene, { type SceneArgs } from "./scene";
import Source from "./source";

export default class Manager {
  scenes: Scene[] = [];

  constructor(
    private ws: OBSWebSocket,
    private logger: Logger
  ) {}

  async init() {
    const obsScenes = await this.ws.call("GetSceneList");
    this.scenes = obsScenes.scenes.map((s) => new Scene(this, s as unknown as SceneArgs));

    for (const scene of this.scenes) {
      const { sceneItems } = await this.ws.call("GetSceneItemList", { sceneName: scene.name });
      for (const item of sceneItems) {
        const source = new Source(this, scene, {
          id: item.sourceUuid as string,
          inputKind: item.inputKind as string,
          name: item.sourceName as string,
          sceneItemId: Number(item.sceneItemId),
        });
        scene.addSource(source);
      }
    }

    this.logger.info("OBS scenes loaded", {
      count: this.scenes.length,
      names: this.scenes.map((s) => s.name),
    });
  }

  async switchScene(sceneName: string) {
    return this.ws.call("SetCurrentProgramScene", { sceneName });
  }

  async getActiveScene(): Promise<Scene | undefined> {
    const scene = await this.ws.call("GetCurrentProgramScene");
    return this.findScene(scene.sceneName);
  }

  findScene(sceneName: string): Scene | undefined {
    return this.scenes.find((s) => s.name === sceneName);
  }

  request<T extends keyof OBSRequestTypes>(cmd: T, args?: OBSRequestTypes[T]): Promise<OBSResponseTypes[T]> {
    return this.ws.call(cmd, args);
  }
}

const OBS_CONNECT_TIMEOUT_MS = 3_000;

/**
 * Open one OBS WebSocket session and load its scenes, or throw. Retrying
 * is the caller's business (see `obs/connection.ts`).
 *
 * The connect is raced against a timeout because obs-websocket-js does
 * not surface one for a stalled TCP handshake.
 */
export async function openObsSession(
  config: { url: string; token?: string },
  logger: Logger
): Promise<ObsSession<Manager>> {
  const ws = new OBSWebSocket();
  // Listened for from the start and latched: the socket can close while the
  // scenes are still loading, before the caller has registered anything, and
  // a close nobody heard would leave a dead session looking connected.
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
    const manager = new Manager(ws, logger);
    await manager.init();
    return {
      client: manager,
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
