import type {
  CommandCreatedEvent,
  CommandDeletedEvent,
  CommandUpdatedEvent,
  CommandWebhookSnapshot,
} from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import { asString, readRow } from "./outbox";
import { subscribeProjections } from "./projection";
import { parseActions } from "./routes/helpers";
import type { WebhookClient } from "./webhook-client";

// The db proxy publishes command lifecycle events on
// `db.command.{created,updated,deleted}`. The CloudEvent's `data` is the
// snake_cased map produced by `buildCommandChangeData` in
// `db/app/services/command_service.go`; a deletion carries only `id` and
// `command`.
//
// The api's own command routes also send these webhooks directly, so a command
// changed through the api reaches the UI twice. That is deliberate: this path
// is the one that covers writers that bypass the api, such as barkloader
// registering a module's commands, and the UI upserts by command id.

interface RawCommandRow {
  id?: unknown;
  command?: unknown;
  actions_json?: unknown;
  cooldown?: unknown;
  priority?: unknown;
  enabled?: unknown;
  visibility?: unknown;
  group_ids?: unknown;
  usernames?: unknown;
  argument_pattern?: unknown;
}

const asNumber = (value: unknown): number => (typeof value === "number" ? value : 0);

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

function buildSnapshot(ce: Record<string, unknown>): CommandWebhookSnapshot | null {
  const row = readRow<RawCommandRow>(ce);
  const id = asString(row.id);
  const command = asString(row.command);
  if (id === "" || command === "") {
    return null;
  }
  return {
    id,
    command,
    actions: parseActions(asString(row.actions_json)),
    cooldown: asNumber(row.cooldown),
    priority: asNumber(row.priority),
    enabled: row.enabled === true,
    visibility: row.visibility === "public" ? "public" : "restricted",
    groupIds: asStringArray(row.group_ids),
    usernames: asStringArray(row.usernames),
    argumentPattern: asString(row.argument_pattern),
  };
}

export function parseCommandCreated(ce: Record<string, unknown>): CommandCreatedEvent | null {
  const command = buildSnapshot(ce);
  return command ? { type: EngineEventType.COMMAND_CREATED, command } : null;
}

export function parseCommandUpdated(ce: Record<string, unknown>): CommandUpdatedEvent | null {
  const command = buildSnapshot(ce);
  return command ? { type: EngineEventType.COMMAND_UPDATED, command } : null;
}

export function parseCommandDeleted(ce: Record<string, unknown>): CommandDeletedEvent | null {
  const row = readRow<RawCommandRow>(ce);
  const commandId = asString(row.id);
  return commandId === "" ? null : { type: EngineEventType.COMMAND_DELETED, commandId };
}

/**
 * Initialise NATS subscriptions for the command CRUD outbox
 * (`db.command.{created,updated,deleted}.*`) and project each onto webhook
 * callbacks, fanned out to every registered client.
 */
export async function initCommandHandlers(
  nats: NATSClient,
  webhookClient: WebhookClient,
  logger: SharedLogger
): Promise<void> {
  const toProjection = (event: CommandCreatedEvent | CommandUpdatedEvent | CommandDeletedEvent | null) =>
    event ? { event } : null;
  await subscribeProjections({ nats, webhookClient, logger }, [
    {
      subject: "db.command.created.*",
      name: "db.command.created",
      parse: (ce) => toProjection(parseCommandCreated(ce)),
    },
    {
      subject: "db.command.updated.*",
      name: "db.command.updated",
      parse: (ce) => toProjection(parseCommandUpdated(ce)),
    },
    {
      subject: "db.command.deleted.*",
      name: "db.command.deleted",
      parse: (ce) => toProjection(parseCommandDeleted(ce)),
    },
  ]);
}
