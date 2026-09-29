// The `engine.obs.command` request/reply handler: the engine asks, this
// service carries the request to OBS over the WebSocket it holds, and answers
// with whether OBS did it.
//
// Every failure is an answer rather than a throw or a silence. The engine is
// waiting on the reply to settle a workflow step (a module action calling
// `ctx.obs`), so a command that cannot be carried out has to say why in words a
// streamer can act on -- the reason becomes the step's error in the run log.

import type { ObsControlCommand, ObsControlReply } from "@woofx3/common/cloudevents/Obs/commands";
import type { Logger } from "@woofx3/common/runtime";
import type { OBSRequestTypes, OBSResponseTypes } from "obs-websocket-js";
import { z } from "zod";

/** The slice of `obs/manager.ts` a command needs; structural so tests can fake OBS. */
export interface ObsControlClient {
  request<T extends keyof OBSRequestTypes>(cmd: T, args?: OBSRequestTypes[T]): Promise<OBSResponseTypes[T]>;
}

/**
 * The answer while no OBS session is open. "Retrying" is always true while
 * this service runs: `obs/connection.ts` keeps trying until it is stopped.
 */
export const OBS_NOT_CONNECTED = "OBS is not connected (retrying)";

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
 * How long one command may take in OBS. Under the engine's 5s request timeout
 * on purpose, so the step fails with this service's reason rather than a bare
 * "no answer". OBS answers a local request in milliseconds; one that has not
 * answered in this long is hung, and the session is recycled.
 */
export const OBS_COMMAND_TIMEOUT_MS = 3_500;

export interface ObsControlOptions {
  timeoutMs?: number;
  /** Called when OBS did not answer in time; the caller drops the session. */
  onTimeout?: () => void;
}

/** A refusal already worded for the streamer, passed through as is. */
class ObsControlError extends Error {}

export class ObsTimeoutError extends Error {}

export function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === OBS_RESOURCE_NOT_FOUND
  );
}

export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ObsTimeoutError(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Carry one command to OBS. `obs` is null while no OBS connection is open,
 * which is answered, not thrown: "OBS is not connected" is the most common
 * reason a step fails and the one a streamer most needs to be told.
 */
export async function executeObsControlCommand(
  obs: ObsControlClient | null,
  command: ObsControlCommand,
  options: ObsControlOptions = {}
): Promise<ObsControlReply> {
  if (!obs) {
    return { ok: false, error: OBS_NOT_CONNECTED };
  }
  const timeoutMs = options.timeoutMs ?? OBS_COMMAND_TIMEOUT_MS;
  try {
    return await withDeadline(runCommand(obs, command), timeoutMs);
  } catch (err) {
    if (err instanceof ObsTimeoutError) {
      options.onTimeout?.();
      return {
        ok: false,
        error: `OBS did not answer within ${timeoutMs / 1000}s; reconnecting to it`,
      };
    }
    return { ok: false, error: describeObsError(command, err) };
  }
}

async function runCommand(obs: ObsControlClient, command: ObsControlCommand): Promise<ObsControlReply> {
  switch (command.command) {
    case "switch_scene": {
      // SetCurrentProgramScene changes what is live even in studio mode,
      // where OBS's own scene list only changes the preview.
      await obs.request("SetCurrentProgramScene", { sceneName: command.sceneName });
      return { ok: true };
    }
    case "set_source_visibility": {
      const sceneName = command.sceneName || (await obs.request("GetCurrentProgramScene")).currentProgramSceneName;
      const item = await findSceneItem(obs, sceneName, command.sourceName, !command.sceneName);
      await obs.request("SetSceneItemEnabled", {
        sceneName: item.sceneName,
        sceneItemId: item.sceneItemId,
        sceneItemEnabled: command.visible,
      });
      return { ok: true };
    }
    case "set_input_mute": {
      await obs.request("SetInputMute", { inputName: command.inputName, inputMuted: command.muted });
      return { ok: true };
    }
  }
}

/**
 * Where a source sits: directly in the scene, or inside one of the scene's
 * groups. A source in a group is not an item of the scene itself, so looking
 * only at the scene would report a source the streamer can see as missing.
 * Its item belongs to the group, and is toggled with the group as the scene.
 */
async function findSceneItem(
  obs: ObsControlClient,
  sceneName: string,
  sourceName: string,
  isCurrentScene: boolean
): Promise<{ sceneName: string; sceneItemId: number }> {
  let sceneItems: Record<string, unknown>[];
  try {
    ({ sceneItems } = await obs.request("GetSceneItemList", { sceneName }));
  } catch (err) {
    if (isNotFound(err)) {
      throw new ObsControlError(`scene ${JSON.stringify(sceneName)} does not exist in OBS`);
    }
    throw err;
  }
  const direct = sceneItems.find((item) => item.sourceName === sourceName);
  if (direct) {
    return { sceneName, sceneItemId: Number(direct.sceneItemId) };
  }

  const groups = sceneItems.filter((item) => item.isGroup === true).map((item) => String(item.sourceName));
  const groupItems = await Promise.all(groups.map((group) => groupSceneItems(obs, group)));
  for (let i = 0; i < groups.length; i++) {
    const nested = groupItems[i].find((item) => item.sourceName === sourceName);
    if (nested) {
      return { sceneName: groups[i], sceneItemId: Number(nested.sceneItemId) };
    }
  }

  const where = isCurrentScene
    ? `the current scene (${JSON.stringify(sceneName)})`
    : `scene ${JSON.stringify(sceneName)}`;
  throw new ObsControlError(`source ${JSON.stringify(sourceName)} is not in ${where} or any group in it`);
}

/** A group's items, or none when the group vanished since it was listed. */
export async function groupSceneItems(obs: ObsControlClient, group: string): Promise<Record<string, unknown>[]> {
  try {
    return (await obs.request("GetGroupSceneItemList", { sceneName: group })).sceneItems;
  } catch (err) {
    if (isNotFound(err)) {
      return [];
    }
    throw err;
  }
}

/**
 * OBS's own not-found text names only the thing it could not find, and in
 * OBS's vocabulary. Said again here in the workflow's terms.
 */
function describeObsError(command: ObsControlCommand, err: unknown): string {
  if (err instanceof ObsControlError) {
    return err.message;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (isNotFound(err)) {
    switch (command.command) {
      case "switch_scene":
        return `scene ${JSON.stringify(command.sceneName)} does not exist in OBS`;
      case "set_input_mute":
        return `input ${JSON.stringify(command.inputName)} does not exist in OBS`;
      case "set_source_visibility":
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
  logger: Logger,
  options: ObsControlOptions = {}
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
  const reply = await executeObsControlCommand(obs, parsed.command, options);
  if (reply.ok) {
    logger.info("engine.obs.command: applied", { command: parsed.command.command });
  } else {
    logger.warn("engine.obs.command: failed", { command: parsed.command.command, error: reply.error });
  }
  return reply;
}

/** The slice of a NATS message `answerObsCommand` needs. */
export interface ObsCommandMessage {
  reply?: string;
  data: Uint8Array;
  respond(data: Uint8Array): boolean;
}

/** The slice of `obs/connection.ts` `answerObsCommand` needs. */
export interface ObsSessionSource {
  current(): ObsControlClient | null;
  recycle(reason: string): void;
}

/**
 * Answer one `engine.obs.command` message.
 *
 * A message with no reply subject is refused before anything reaches OBS.
 * The one legitimate sender, barkloader's `ctx.obs` extension, sends a request and
 * waits for the answer, so a bare publish on this subject comes from something
 * that is not the engine, and OBS control is not something anything else on
 * the bus may drive.
 */
export async function answerObsCommand(obs: ObsSessionSource, msg: ObsCommandMessage, logger: Logger): Promise<void> {
  if (!msg.reply) {
    logger.warn("engine.obs.command: refused a message with no reply subject; OBS control is request/reply only");
    return;
  }
  try {
    const reply = await handleObsControlRequest(obs.current(), msg.data, logger, {
      onTimeout: () => obs.recycle("an OBS request timed out"),
    });
    msg.respond(new TextEncoder().encode(JSON.stringify(reply)));
  } catch (err) {
    // handleObsControlRequest answers every failure it knows of; this is the
    // one it does not, and the requester is still owed an answer.
    const error = err instanceof Error ? err.message : String(err);
    logger.error("engine.obs.command: handler failed", { error });
    msg.respond(new TextEncoder().encode(JSON.stringify({ ok: false, error: `scene manager error: ${error}` })));
  }
}
