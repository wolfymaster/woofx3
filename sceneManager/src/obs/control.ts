// The `engine.obs.command` request/reply handler: the engine asks, this
// service carries the request to OBS over the WebSocket it holds, and answers
// with whether OBS did it.
//
// Every failure is an answer rather than a throw or a silence. The engine is
// waiting on the reply to settle a workflow step, so a command that cannot be
// carried out has to say why in words a streamer can act on -- the reason
// becomes the step's error in the run log.

import type {
  ObsControlCommand,
  ObsControlReply,
  ObsSceneSource,
  ObsSceneSummary,
} from "@woofx3/common/cloudevents/Obs/commands";
import type { Logger } from "@woofx3/common/runtime";
import type { OBSRequestTypes, OBSResponseTypes } from "obs-websocket-js";
import { z } from "zod";

/** The slice of `obs/manager.ts` a command needs; structural so tests can fake OBS. */
export interface ObsControlClient {
  request<T extends keyof OBSRequestTypes>(cmd: T, args?: OBSRequestTypes[T]): Promise<OBSResponseTypes[T]>;
}

/** obs-websocket v5 RequestStatus.ResourceNotFound. */
const OBS_RESOURCE_NOT_FOUND = 600;

const nonEmptyName = z.string().min(1);

// Mirrors ObsControlCommand in shared/common/typescript/cloudevents/Obs/commands.ts.
// `.strict()` so a misspelled field is refused rather than silently ignored:
// `visibile: false` must not read as a command with no visibility.
const commandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("switch_scene"), sceneName: nonEmptyName }).strict(),
  z
    .object({
      command: z.literal("set_source_visibility"),
      sceneName: z.string().optional(),
      sourceName: nonEmptyName,
      visible: z.boolean(),
    })
    .strict(),
  z.object({ command: z.literal("set_input_mute"), inputName: nonEmptyName, muted: z.boolean() }).strict(),
  z.object({ command: z.literal("list_scenes") }).strict(),
]);

export type ParsedObsCommand = { ok: true; command: ObsControlCommand } | { ok: false; error: string };

/** Validate the `data` of an `engine.obs.command` CloudEvent. */
export function parseObsControlCommand(data: unknown): ParsedObsCommand {
  const parsed = commandSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    });
    return { ok: false, error: `invalid OBS command: ${issues.join("; ")}` };
  }
  return { ok: true, command: parsed.data };
}

/**
 * Carry one command to OBS. `obs` is null while no OBS connection is open,
 * which is answered, not thrown: "OBS is not connected" is the most common
 * reason a step fails and the one a streamer most needs to be told.
 */
export async function executeObsControlCommand(
  obs: ObsControlClient | null,
  command: ObsControlCommand
): Promise<ObsControlReply> {
  if (!obs) {
    return { ok: false, error: "OBS is not connected to the scene manager" };
  }
  try {
    switch (command.command) {
      case "switch_scene": {
        await obs.request("SetCurrentProgramScene", { sceneName: command.sceneName });
        return { ok: true };
      }
      case "set_source_visibility": {
        const sceneName = command.sceneName || (await obs.request("GetCurrentProgramScene")).currentProgramSceneName;
        const { sceneItemId } = await obs.request("GetSceneItemId", {
          sceneName,
          sourceName: command.sourceName,
        });
        await obs.request("SetSceneItemEnabled", {
          sceneName,
          sceneItemId,
          sceneItemEnabled: command.visible,
        });
        return { ok: true };
      }
      case "set_input_mute": {
        await obs.request("SetInputMute", { inputName: command.inputName, inputMuted: command.muted });
        return { ok: true };
      }
      case "list_scenes": {
        return { ok: true, scenes: await listScenes(obs) };
      }
    }
  } catch (err) {
    return { ok: false, error: describeObsError(command, err) };
  }
}

/**
 * Scenes in the order OBS's own scene list shows them, top first. OBS numbers
 * scenes from the bottom of that list, so the highest `sceneIndex` is the top.
 */
async function listScenes(obs: ObsControlClient): Promise<ObsSceneSummary[]> {
  const { scenes } = await obs.request("GetSceneList");
  const ordered = [...scenes].sort((a, b) => Number(b.sceneIndex) - Number(a.sceneIndex));
  const summaries: ObsSceneSummary[] = [];
  for (const scene of ordered) {
    const name = String(scene.sceneName);
    const { sceneItems } = await obs.request("GetSceneItemList", { sceneName: name });
    const sources: ObsSceneSource[] = sceneItems.map((item) => ({
      name: String(item.sourceName),
      sceneItemId: Number(item.sceneItemId),
      inputKind: typeof item.inputKind === "string" ? item.inputKind : null,
      enabled: item.sceneItemEnabled === true,
    }));
    summaries.push({ name, sources });
  }
  return summaries;
}

/**
 * OBS's own not-found text names only the thing it could not find, and in
 * OBS's vocabulary. Said again here in the workflow's terms, naming the
 * scene the source was looked for in, which OBS leaves out.
 */
function describeObsError(command: ObsControlCommand, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = typeof err === "object" && err !== null && "code" in err ? (err as { code: unknown }).code : undefined;
  if (code === OBS_RESOURCE_NOT_FOUND) {
    switch (command.command) {
      case "switch_scene":
        return `scene ${JSON.stringify(command.sceneName)} does not exist in OBS`;
      case "set_source_visibility":
        return command.sceneName
          ? `source ${JSON.stringify(command.sourceName)} is not in scene ${JSON.stringify(command.sceneName)} (or that scene does not exist)`
          : `source ${JSON.stringify(command.sourceName)} is not in the current scene`;
      case "set_input_mute":
        return `input ${JSON.stringify(command.inputName)} does not exist in OBS`;
      case "list_scenes":
        break;
    }
  }
  return `OBS refused ${command.command}: ${message}`;
}

/**
 * Decode an `engine.obs.command` CloudEvent, run its command, and produce the
 * reply. Never throws: every outcome, including a malformed request, is a reply
 * the requester is waiting for.
 */
export async function handleObsControlRequest(
  obs: ObsControlClient | null,
  raw: Uint8Array,
  logger: Logger
): Promise<ObsControlReply> {
  let envelope: { data?: unknown };
  try {
    envelope = JSON.parse(new TextDecoder().decode(raw)) as { data?: unknown };
  } catch (err) {
    logger.warn("engine.obs.command: malformed JSON payload", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "invalid OBS command: payload is not JSON" };
  }
  const parsed = parseObsControlCommand(envelope?.data);
  if (!parsed.ok) {
    logger.warn("engine.obs.command: refused", { error: parsed.error });
    return parsed;
  }
  const reply = await executeObsControlCommand(obs, parsed.command);
  if (reply.ok) {
    // A scene listing is a read the UI may repeat; only changes to OBS are worth a line at info.
    const log = parsed.command.command === "list_scenes" ? logger.debug : logger.info;
    log.call(logger, "engine.obs.command: applied", { command: parsed.command.command });
  } else {
    logger.warn("engine.obs.command: failed", { command: parsed.command.command, error: reply.error });
  }
  return reply;
}
