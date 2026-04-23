import type { ConfigField } from "@woofx3/api/ui-schema";
import type { DatabaseClient } from "./services/database";

// A single select field sourced dynamically. The UI's custom renderer (Phase E)
// reads source.kind and fetches the command list at render time — the concrete
// options are not known at manifest/registration time.
const COMMAND_TRIGGER_SCHEMA: ConfigField[] = [
  {
    id: "command",
    label: "Command",
    type: "select",
    required: true,
    source: { kind: "commands" },
  },
];

// Event is a template; the workflow builder resolves it per-workflow to a
// concrete chat.command.<slug> subject based on the selected command.
const CHAT_COMMAND_TRIGGER_INPUT = {
  category: "platform.twitch",
  name: "Chat Command",
  description: "Fires when a viewer issues a chat command.",
  event: "chat.command",
  configSchema: JSON.stringify(COMMAND_TRIGGER_SCHEMA),
  allowVariants: false,
};

const SYSTEM_CREATED_BY_TYPE = "SYSTEM";
const SYSTEM_CREATED_BY_REF = "woofwoofwoof";

/**
 * Idempotent startup registration of woofwoofwoof's built-in triggers with
 * the DB proxy. Uses created_by_type = "SYSTEM" so the registry can
 * distinguish system-provided triggers from module-provided ones; upsert on
 * (created_by_type, created_by_ref, name) means repeated startups are safe.
 */
export async function registerBuiltinTriggers(client: DatabaseClient): Promise<void> {
  const response = await client.registerTriggers({
    moduleKey: "",
    moduleName: "woofwoofwoof",
    version: "builtin",
    triggers: [CHAT_COMMAND_TRIGGER_INPUT],
    createdByType: SYSTEM_CREATED_BY_TYPE,
    createdByRef: SYSTEM_CREATED_BY_REF,
  });

  if (response.status.code !== "OK") {
    throw new Error(`RegisterTriggers returned ${response.status.code}: ${response.status.message}`);
  }
}
