// The `engine.scene.command` request/reply handler: the engine asks for a
// change to a scene (a workflow step), this service makes it on the scene's
// published version, and answers whether it could. The change is an op like
// an editor's, so every open overlay and editor follows it, it is saved with
// the scene, and it is copied into the draft.
//
// Every failure is an answer rather than a throw or a silence. The engine is
// waiting on the reply to settle a workflow step, so a command that cannot be
// carried out has to say why in words a streamer can act on -- the reason
// becomes the step's error in the run log.

import type { SceneControlCommand, SceneControlReply } from "@woofx3/common/cloudevents/Scene/commands";
import type { Logger } from "@woofx3/common/runtime";
import { z } from "zod";
import type { Json0Component, SceneSnapshot } from "../../public/scene-manager/scene-document";
import type { SceneVersion } from "./scene-host";

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

/** The slice of `SceneDocuments` a command changes a scene through. */
export interface SceneCommandDeps {
  applyChange(
    sceneId: string,
    version: SceneVersion,
    change: (snapshot: SceneSnapshot) => Json0Component[] | { error: string }
  ): Promise<{ ok: true } | { ok: false; error: string }>;
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
  const result = await deps.applyChange(command.sceneId, "published", (snapshot) => {
    const placement = snapshot.doc.widgets[command.placementId];
    if (!placement) {
      return {
        error: `widget placement ${JSON.stringify(command.placementId)} is not on scene ${JSON.stringify(snapshot.name)}`,
      };
    }
    if (placement.visible === command.visible) {
      return [];
    }
    return [{ p: ["widgets", command.placementId, "visible"], od: placement.visible, oi: command.visible }];
  });
  if (!result.ok && result.error === "not_found") {
    return { ok: false, error: `scene ${JSON.stringify(command.sceneId)} does not exist` };
  }
  return result;
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
