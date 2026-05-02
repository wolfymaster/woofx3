import OBSWebSocket, { type OBSRequestTypes, type OBSResponseTypes } from "obs-websocket-js";
import type { SharedLogger } from "@woofx3/common/logging";
import Scene, { type SceneArgs } from "./scene";
import Source from "./source";

export default class Manager {
  scenes: Scene[] = [];

  constructor(
    private ws: OBSWebSocket,
    private logger: SharedLogger,
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

  request<T extends keyof OBSRequestTypes>(cmd: T, args: OBSRequestTypes[T]): Promise<OBSResponseTypes[T]> {
    return this.ws.call(cmd, args);
  }
}

const OBS_CONNECT_TIMEOUT_MS = 3_000;

/**
 * Best-effort connect: if OBS isn't running, log a warning and return
 * `null` so the alert overlay still works without OBS being open. We
 * race the connect against a short timeout because obs-websocket-js
 * doesn't surface a timeout for a stalled TCP handshake.
 */
export async function connectObs(
  config: { url: string; token?: string },
  logger: SharedLogger,
): Promise<Manager | null> {
  const ws = new OBSWebSocket();
  try {
    await Promise.race([
      ws.connect(config.url, config.token),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${OBS_CONNECT_TIMEOUT_MS}ms`)), OBS_CONNECT_TIMEOUT_MS),
      ),
    ]);
    logger.info("Connected to OBS", { url: config.url });
    const manager = new Manager(ws, logger);
    await manager.init();
    return manager;
  } catch (err) {
    logger.warn("OBS connection failed; continuing without OBS control", {
      url: config.url,
      error: err instanceof Error ? err.message : String(err),
    });
    // Don't await disconnect — if the underlying connect is still
    // hanging, awaiting here would hang too. Fire-and-forget cleanup.
    void ws.disconnect().catch(() => undefined);
    return null;
  }
}
