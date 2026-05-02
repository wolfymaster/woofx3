import type { SharedLogger } from "@woofx3/common/logging";
import type Manager from "./obs/manager";

interface SlobsLegacyMessage {
  command: string;
  args: Record<string, string>;
}

/**
 * Dispatch the subset of legacy `slobs`-subject commands that controlled
 * OBS scenes/sources. The InstantDB-backed commands (alert_message,
 * count, paint, setTime, updateTime) are intentionally not handled —
 * those have been replaced by the workflow `alert` action and are out of
 * scope for the streamware MVP.
 */
export async function handleLegacySlobsCommand(
  obs: Manager | null,
  msg: SlobsLegacyMessage,
  logger: SharedLogger,
): Promise<void> {
  const { command, args } = msg;

  if (!obs) {
    if (command === "scene_change" || command === "source_change" || command === "source_blur") {
      logger.warn("Legacy slobs command ignored — OBS not connected", { command });
    }
    return;
  }

  switch (command) {
    case "scene_change": {
      const sceneName = args?.sceneName;
      if (!sceneName) {
        logger.warn("scene_change missing sceneName", { args });
        return;
      }
      const scene = obs.findScene(sceneName);
      if (!scene) {
        logger.warn("scene_change: scene not found", { sceneName });
        return;
      }
      await obs.switchScene(scene.name);
      return;
    }

    case "source_change": {
      const { sourceName, value } = args ?? {};
      const currentScene = await obs.getActiveScene();
      if (!currentScene) {
        logger.warn("source_change: no active scene");
        return;
      }
      const src = currentScene.findSource(sourceName);
      if (!src) {
        logger.warn("source_change: source not found", { sourceName, scene: currentScene.name });
        return;
      }
      if (value === "on") {
        await src.showSource();
      } else {
        await src.hideSource();
      }
      return;
    }

    case "source_blur": {
      const { sceneName, sourceName, value } = args ?? {};
      const scene = obs.findScene(sceneName);
      if (!scene) {
        logger.warn("source_blur: scene not found", { sceneName });
        return;
      }
      const source = scene.findSource(sourceName);
      if (!source) {
        logger.warn("source_blur: source not found", { sceneName, sourceName });
        return;
      }
      await source.setAnimatedFilterValue("Composite Blur", "radius", Number(value), {
        durationMs: 2000,
      });
      return;
    }

    default:
      // Other legacy commands (alert_message, count, paint, setTime,
      // updateTime) are no longer handled — see the file header comment.
      logger.debug("Ignoring unsupported legacy slobs command", { command });
  }
}
