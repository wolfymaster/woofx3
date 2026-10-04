// The `engine.scene.command` request/reply handler: the engine asks for a
// change to a live scene, this service makes it on every open overlay of that
// scene, and answers whether it could.
//
// Every failure is an answer rather than a throw or a silence. The engine is
// waiting on the reply to settle a workflow step, so a command that cannot be
// carried out has to say why in words a streamer can act on -- the reason
// becomes the step's error in the run log.

import type { SceneControlCommand, SceneControlReply } from "@woofx3/common/cloudevents/Scene/commands";
import type { Logger } from "@woofx3/common/runtime";
import { z } from "zod";
import type { PlacementVisibility } from "./placement-visibility";
import type { OverlaySceneState } from "./scene-host";

/** SSE frame an overlay hides or shows a placement on. */
export const PLACEMENT_VISIBILITY_FRAME = "placement-visibility";

const nonEmptyId = z.string().min(1);

// Mirrors SceneControlCommand in shared/common/typescript/cloudevents/Scene/commands.ts.
// `.strict()` so a misspelled field is refused rather than silently ignored.
const commandSchema = z.discriminatedUnion("command", [
  z
    .object({
      command: z.literal("set_placement_visibility"),
      sceneId: nonEmptyId,
      placementId: nonEmptyId,
      visible: z.boolean(),
    })
    .strict(),
]);

export interface SceneCommandDeps {
  loadSceneById(sceneId: string): Promise<OverlaySceneState | null>;
  visibility: PlacementVisibility;
  broadcast(sceneId: string, event: string, data: unknown): void;
}

export type ParsedSceneCommand = { ok: true; command: SceneControlCommand } | { ok: false; error: string };

/** Validate the `data` of an `engine.scene.command` CloudEvent. */
export function parseSceneControlCommand(data: unknown): ParsedSceneCommand {
  const parsed = commandSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    });
    return { ok: false, error: `invalid scene command: ${issues.join("; ")}` };
  }
  return { ok: true, command: parsed.data };
}

export async function executeSceneControlCommand(
  deps: SceneCommandDeps,
  command: SceneControlCommand
): Promise<SceneControlReply> {
  const scene = await deps.loadSceneById(command.sceneId);
  if (!scene) {
    return { ok: false, error: `scene ${JSON.stringify(command.sceneId)} does not exist` };
  }
  const placement = scene.instances.find((instance) => instance.id === command.placementId);
  if (!placement) {
    return {
      ok: false,
      error: `widget placement ${JSON.stringify(command.placementId)} is not on scene ${JSON.stringify(scene.name)}`,
    };
  }
  deps.visibility.set(scene.sceneId, placement, command.visible);
  deps.broadcast(scene.sceneId, PLACEMENT_VISIBILITY_FRAME, { instanceId: placement.id, visible: command.visible });
  return { ok: true };
}

/** The slice of a NATS message `answerSceneCommand` needs. */
export interface SceneCommandMessage {
  reply?: string;
  data: Uint8Array;
  respond(data: Uint8Array): boolean;
}

/**
 * Answer one `engine.scene.command` message. Never throws: every outcome,
 * including a malformed request, is a reply the requester is waiting for.
 *
 * A message with no reply subject is refused before anything changes. The one
 * legitimate sender, the workflow engine, sends a request and waits for the
 * answer, so a bare publish on this subject comes from something that is not
 * the engine.
 */
export async function answerSceneCommand(
  deps: SceneCommandDeps,
  msg: SceneCommandMessage,
  logger: Logger
): Promise<void> {
  if (!msg.reply) {
    logger.warn("engine.scene.command: refused a message with no reply subject; scene control is request/reply only");
    return;
  }
  const reply = await handleSceneControlRequest(deps, msg.data, logger);
  msg.respond(new TextEncoder().encode(JSON.stringify(reply)));
}

async function handleSceneControlRequest(
  deps: SceneCommandDeps,
  raw: Uint8Array,
  logger: Logger
): Promise<SceneControlReply> {
  let envelope: { data?: unknown };
  try {
    envelope = JSON.parse(new TextDecoder().decode(raw)) as { data?: unknown };
  } catch (err) {
    logger.warn("engine.scene.command: malformed JSON payload", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "invalid scene command: payload is not JSON" };
  }
  const parsed = parseSceneControlCommand(envelope?.data);
  if (!parsed.ok) {
    logger.warn("engine.scene.command: refused", { error: parsed.error });
    return parsed;
  }
  try {
    const reply = await executeSceneControlCommand(deps, parsed.command);
    if (reply.ok) {
      logger.info("engine.scene.command: applied", {
        command: parsed.command.command,
        sceneId: parsed.command.sceneId,
        placementId: parsed.command.placementId,
        visible: parsed.command.visible,
      });
    } else {
      logger.warn("engine.scene.command: failed", { command: parsed.command.command, error: reply.error });
    }
    return reply;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("engine.scene.command: handler failed", { error });
    return { ok: false, error: `scene manager error: ${error}` };
  }
}
