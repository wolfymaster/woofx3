// The `engine.obs.options` request/reply handler: lists OBS's scenes, sources
// or inputs as field options, for the manifest fields of the `obs.*` workflow
// actions. The api's `dispatchFieldOptionsRequest` sends the request and hands
// the reply to the UI as-is, so the reply is already in the UI's option shape.
//
// Read-only on purpose. A field source's payload is whatever a manifest wrote,
// so the subject it names must not be one that can change OBS; changes go over
// `engine.obs.command`, which only the engine's workflow actions send.

import {
  OBS_OPTIONS_LISTS,
  type ObsFieldOption,
  type ObsOptionsList,
  type ObsOptionsReply,
} from "@woofx3/common/cloudevents/Obs/commands";
import type { Logger } from "@woofx3/common/runtime";
import { z } from "zod";
import {
  groupSceneItems,
  isNotFound,
  OBS_COMMAND_TIMEOUT_MS,
  OBS_NOT_CONNECTED,
  type ObsCommandMessage,
  type ObsControlClient,
  type ObsControlOptions,
  type ObsSessionSource,
  ObsTimeoutError,
  withDeadline,
} from "./control";

const requestSchema = z.object({ list: z.enum(OBS_OPTIONS_LISTS) }).strict();

/**
 * Input kinds that only carry audio, across OBS's platforms. Listed ahead of
 * the other inputs, which can carry audio too (media, browser, capture) and so
 * are listed after these rather than left out.
 */
const AUDIO_INPUT_KINDS: ReadonlySet<string> = new Set([
  "wasapi_input_capture",
  "wasapi_output_capture",
  "wasapi_process_output_capture",
  "pulse_input_capture",
  "pulse_output_capture",
  "alsa_input_capture",
  "jack_input_client",
  "jack_output_client",
  "coreaudio_input_capture",
  "coreaudio_output_capture",
  "sck_audio_capture",
]);

export function isAudioInputKind(inputKind: string): boolean {
  return AUDIO_INPUT_KINDS.has(inputKind) || inputKind.includes("audio");
}

/** Scene names in the order OBS's scene list shows them; OBS numbers them from the bottom. */
async function sceneNames(obs: ObsControlClient): Promise<string[]> {
  const { scenes } = await obs.request("GetSceneList");
  return [...scenes]
    .sort((a, b) => Number(b.sceneIndex) - Number(a.sceneIndex))
    .map((scene) => String(scene.sceneName));
}

async function listScenes(obs: ObsControlClient): Promise<ObsFieldOption[]> {
  return (await sceneNames(obs)).map((name) => ({ value: name, label: name }));
}

/**
 * Every scene's sources, headed by the scene. A source inside a group is
 * labelled "Group › Source" but saved by its own name, which is what
 * `set_source_visibility` looks for. A scene removed between the listing and
 * the read of its items is left out rather than failing the whole listing.
 */
async function listSources(obs: ObsControlClient): Promise<ObsFieldOption[]> {
  const names = await sceneNames(obs);
  const perScene = await Promise.all(
    names.map(async (scene): Promise<ObsFieldOption[]> => {
      let sceneItems: Record<string, unknown>[];
      try {
        ({ sceneItems } = await obs.request("GetSceneItemList", { sceneName: scene }));
      } catch (err) {
        if (isNotFound(err)) {
          return [];
        }
        throw err;
      }
      const expanded = await Promise.all(
        sceneItems.map(async (item): Promise<ObsFieldOption[]> => {
          const name = String(item.sourceName);
          const own = { value: name, label: name, group: scene };
          if (item.isGroup !== true) {
            return [own];
          }
          const children = await groupSceneItems(obs, name);
          return [
            own,
            ...children.map((child) => {
              const childName = String(child.sourceName);
              return { value: childName, label: `${name} › ${childName}`, group: scene };
            }),
          ];
        })
      );
      const seen = new Set<string>();
      return expanded.flat().filter((option) => {
        if (seen.has(option.value)) {
          return false;
        }
        seen.add(option.value);
        return true;
      });
    })
  );
  return perScene.flat();
}

/**
 * Every input OBS has, audio-only kinds first. From OBS's input list rather
 * than the scenes, so the global audio devices set in OBS's audio settings
 * (Desktop Audio, Mic/Aux), which sit in no scene, are listed too.
 */
async function listInputs(obs: ObsControlClient): Promise<ObsFieldOption[]> {
  const { inputs } = await obs.request("GetInputList");
  const audio: ObsFieldOption[] = [];
  const other: ObsFieldOption[] = [];
  for (const input of inputs) {
    const name = String(input.inputName);
    const kind = String(input.unversionedInputKind ?? input.inputKind ?? "");
    (isAudioInputKind(kind) ? audio : other).push({ value: name, label: name });
  }
  const otherHeading = audio.length > 0 ? "Other inputs" : "Inputs";
  return [
    ...audio.map((option) => ({ ...option, group: "Audio inputs" })),
    ...other.map((option) => ({ ...option, group: otherHeading })),
  ];
}

const LISTERS: Readonly<Record<ObsOptionsList, (obs: ObsControlClient) => Promise<ObsFieldOption[]>>> = {
  scenes: listScenes,
  sources: listSources,
  inputs: listInputs,
};

/**
 * List what `list` names. `obs` is null while no OBS connection is open, which
 * is answered with the reason so the UI can say why the picker is empty.
 */
export async function executeObsOptionsRequest(
  obs: ObsControlClient | null,
  list: ObsOptionsList,
  options: ObsControlOptions = {}
): Promise<ObsOptionsReply> {
  if (!obs) {
    return { error: OBS_NOT_CONNECTED };
  }
  const timeoutMs = options.timeoutMs ?? OBS_COMMAND_TIMEOUT_MS;
  try {
    return await withDeadline(LISTERS[list](obs), timeoutMs);
  } catch (err) {
    if (err instanceof ObsTimeoutError) {
      options.onTimeout?.();
      return { error: `OBS did not answer within ${timeoutMs / 1000}s; reconnecting to it` };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { error: `OBS could not list ${list}: ${message}` };
  }
}

/** Decode an `engine.obs.options` CloudEvent and list what it asks for. Never throws. */
export async function handleObsOptionsRequest(
  obs: ObsControlClient | null,
  raw: Uint8Array,
  logger: Logger,
  options: ObsControlOptions = {}
): Promise<ObsOptionsReply> {
  let envelope: { data?: unknown };
  try {
    envelope = JSON.parse(new TextDecoder().decode(raw)) as { data?: unknown };
  } catch {
    logger.warn("engine.obs.options: malformed JSON payload");
    return { error: "invalid OBS options request: payload is not JSON" };
  }
  const parsed = requestSchema.safeParse(envelope?.data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    });
    logger.warn("engine.obs.options: refused", { issues });
    return { error: `invalid OBS options request: ${issues.join("; ")}` };
  }
  const reply = await executeObsOptionsRequest(obs, parsed.data.list, options);
  if (Array.isArray(reply)) {
    logger.debug("engine.obs.options: listed", { list: parsed.data.list, count: reply.length });
  } else {
    logger.warn("engine.obs.options: failed", { list: parsed.data.list, error: reply.error });
  }
  return reply;
}

/** Answer one `engine.obs.options` message; one with no reply subject has no one to answer. */
export async function answerObsOptions(obs: ObsSessionSource, msg: ObsCommandMessage, logger: Logger): Promise<void> {
  if (!msg.reply) {
    logger.warn("engine.obs.options: ignored a message with no reply subject; listing is request/reply only");
    return;
  }
  try {
    const reply = await handleObsOptionsRequest(obs.current(), msg.data, logger, {
      onTimeout: () => obs.recycle("an OBS request timed out"),
    });
    msg.respond(new TextEncoder().encode(JSON.stringify(reply)));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("engine.obs.options: handler failed", { error });
    msg.respond(new TextEncoder().encode(JSON.stringify({ error: `scene manager error: ${error}` })));
  }
}
