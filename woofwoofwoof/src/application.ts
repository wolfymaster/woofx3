import type { BarkloaderMessageResponse } from "@woofx3/barkloader";
import type { ActionStep } from "@woofx3/common/cloudevents/Action";
import { commandNameToSubjectSegment } from "@woofx3/common/cloudevents/slug";
import { parseCommandVariables } from "@woofx3/common/templates/command-variables";
import { EventType as ChatEventType, type SendMessageMessage } from "@woofx3/common/cloudevents/Chat";
import {
  type CommandCreatedMessage,
  type CommandDeletedMessage,
  EventType as CommandEventType,
  type CommandUpdatedMessage,
} from "@woofx3/common/cloudevents/Command";
import EventFactory from "@woofx3/common/cloudevents/EventFactory";
import { subscribeToSessionUpdates } from "@woofx3/common/cloudevents/session-subscriber";
import { SpanKind, withSpan } from "@woofx3/common/logging";
import { type ChatMessageMessage, EventType } from "@woofx3/common/cloudevents/Twitch";
import type { ApplicationContext } from "@woofx3/common/runtime";
import type { Application, IApplication } from "@woofx3/common/runtime/application";
import type { Command } from "@woofx3/db/command.pb";
import type { Msg } from "@woofx3/nats/src/types";
import chalk from "chalk";
import { type ChatRole, type CommandInvocation, Commands } from "./commands";
import type BarkloaderClientService from "./services/barkloader";
import type DatabaseService from "./services/database";
import type MessageBusService from "./services/messageBus";
import type TwitchChatClientService from "./services/twitchChat";
import { DerivedGroupSync } from "./derivedGroupSync";
import { canUse, parseTime } from "./util";

type Context = ApplicationContext<WoofWoofWoofContext, WoofWoofWoofServices>;

/**
 * Who can run the built-in commands that change the channel (!title,
 * !category, !marker) without a grant. Anyone else needs a permission grant
 * on `command/<name>`, the same as any restricted command.
 */
const CHANNEL_EDITOR_ROLES: ChatRole[] = ["broadcaster", "moderator"];

/** How long a built-in command waits on the twitch service before giving up. */
const TWITCH_REQUEST_TIMEOUT_MS = 10_000;

/** The reply type the twitch service answers a refused request with; see twitch/src/application.ts. */
const TWITCH_ERROR_TYPE = "twitchapi.error";

/** The fields of the twitch service's replies the built-in commands read. */
interface UpdateStreamResult {
  title?: string;
  categoryName?: string;
}

interface StreamMarkerResult {
  positionSeconds: number;
}

/** No answer from the twitch service within the wait; it may still act. */
class TwitchRequestTimeout extends Error {}

/**
 * The chat reply for a built-in command that did not get a success back.
 * A timeout is reported as unknown rather than failed: the twitch service
 * may have applied the change after the wait ran out, and a chatter told it
 * failed would retry a change that already happened.
 */
export function failureReply(action: string, err: unknown): string {
  if (err instanceof TwitchRequestTimeout) {
    return `No answer from Twitch yet, so it is unknown whether I could ${action}; it may still apply`;
  }
  return `Could not ${action}: ${err instanceof Error ? err.message : String(err)}`;
}

/** The NATS client's request failures, told apart by name and message. */
function toTwitchRequestError(err: unknown): Error {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.name : "";
  if (name === "TimeoutError" || message === "timeout" || message === "TIMEOUT") {
    return new TwitchRequestTimeout(message);
  }
  if (cause === "NoResponders" || message.includes("no responders") || message.includes("503")) {
    return new Error("The Twitch service is not running");
  }
  return err instanceof Error ? err : new Error(message);
}

/** `positionSeconds` into the broadcast as h:mm:ss. */
export function formatStreamPosition(positionSeconds: number): string {
  const hours = Math.floor(positionSeconds / 3600);
  const minutes = Math.floor((positionSeconds % 3600) / 60);
  const seconds = Math.floor(positionSeconds % 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export type WoofWoofWoofServices = {
  barkloader: BarkloaderClientService;
  db: DatabaseService;
  messageBus: MessageBusService;
  twitchChat: TwitchChatClientService;
};

// Full context type - with typed services
export type WoofWoofWoofContext = {
  commander?: Commands;
  events: EventFactory;
};

export type WoofWoofWoofApplication = Application<Context, WoofWoofWoofServices>;

export default class WoofWoofWoof implements IApplication<WoofWoofWoofContext, WoofWoofWoofServices> {
  readonly context: WoofWoofWoofContext;
  // Type marker for final context - used only for type inference, never accessed at runtime
  readonly __finalContextType!: WoofWoofWoofContext;
  // Mirror of the engine's command rows keyed by engine id. The id-keyed map
  // is needed for `command.deleted` events, which only carry the id — we
  // look up the command name to remove from the in-memory commander.
  private commandsByEngineId = new Map<string, Command>();

  constructor() {
    this.context = {
      events: new EventFactory({ source: "woofwoofwoof" }),
    };
  }

  async init(ctx: Context) {
    // Before the commander or any subscriber below can publish. Every event
    // this service emits is stamped with the session this holder learns from
    // the bus.
    await subscribeToSessionUpdates(ctx.services.messageBus.client, ctx.logger);

    const db = ctx.services.db.client;

    const commander = new Commands(ctx.services.twitchChat, {
      publisher: (match) => {
        const [subject, data] = ctx.events.ChatCommand().command(match.commandName, {
          args: match.args,
          rawMessage: match.rawMessage,
          text: match.text,
          variables: match.variables,
          chatter: match.chatter,
          platform: "twitch",
        });
        ctx.services.messageBus.client.publish(subject, data);
      },
      onPublishError: (err, match) => {
        ctx.logger.error("Failed to publish chat.command event", match.commandName, err);
      },
    });
    commander.setAuth(async (user: string, cmd: string) => {
      return await canUse(user, cmd, db);
    });

    // register message handler for barkloader
    ctx.services.barkloader.client.registerHandler("onMessage", (message: BarkloaderMessageResponse) => {
      ctx.logger.info("recived on socket", message);
      try {
        if (message.error) {
          ctx.logger.error(message);
          return;
        }
        if (message.command && ctx.commander) {
          ctx.commander.send(message.args.message, {}, false);
        }
      } catch {
        ctx.logger.error("failed to parse websocket message as json");
      }
    });

    // Keeps the built-in subscriber/vip/moderator/broadcaster groups in step
    // with the membership reported on each chat message.
    const derivedGroupSync = new DerivedGroupSync(db, ctx.logger);

    // subscribe to chat message events
    ctx.services.messageBus.client.subscribe(EventType.ChatMessage, async (msg: Msg) => {
      await withSpan(
        "woofwoofwoof.chat.message",
        async () => {
          const payload = msg.json<ChatMessageMessage>();
          // Reconcile before dispatching so freshly-granted membership is
          // already reflected when the command's permission check runs.
          if (payload.data.membership) {
            await derivedGroupSync.reconcile(payload.data.chatterName, payload.data.membership);
          }
          const [message, matched] = await commander.process(
            payload.data.message,
            payload.data.chatterName,
            payload.data.membership,
            payload.data.chatterId
          );
          if (matched && message) {
            await commander.send(message);
          }
        },
        { attributes: { "messaging.system": "nats" }, kind: SpanKind.CONSUMER }
      );
    });

    // subscribe to outbound send-chat-message events from sandbox functions
    // payload.data.platform discriminates target platform (twitch only today)
    ctx.services.messageBus.client.subscribe(ChatEventType.SendMessage, async (msg: Msg) => {
      await withSpan(
        "woofwoofwoof.chat.send-message",
        async () => {
          const payload = msg.json<SendMessageMessage>();
          const text = payload?.data?.message;
          if (!text || !ctx.commander) {
            return;
          }
          await ctx.commander.send(text);
        },
        { attributes: { "messaging.system": "nats" }, kind: SpanKind.CONSUMER }
      );
    });

    // Reload the Twitch chat client when the engine reports that an
    // integration token was updated. Triggered by the UI's Settings →
    // Integrations Connect / Disconnect flow — without this, our
    // in-memory RefreshingAuthProvider keeps using the pre-reconnect
    // token (and pre-reconnect scopes) until woofwoofwoof restarts.
    ctx.services.messageBus.client.subscribe("setting.integration.token.updated", async (msg: Msg) => {
      await withSpan(
        "woofwoofwoof.setting.integration.token.updated",
        async () => {
          const payload = msg.json<{ data?: { integration?: string } }>();
          const integration = payload?.data?.integration;
          if (integration !== "twitch") {
            return;
          }
          ctx.logger.info("setting.integration.token.updated received — reloading twitch chat", {
            integration,
          });
          try {
            await ctx.services.twitchChat.reload();
          } catch (err) {
            ctx.logger.error("twitch chat reload failed", { err });
          }
        },
        { attributes: { "messaging.system": "nats" }, kind: SpanKind.CONSUMER }
      );
    });

    // Hot-reload of chat commands: the engine emits these from Api.create/
    // update/deleteCommand, so user CRUD in woofx3-ui takes effect without
    // restarting woofwoofwoof. The events carry CommandSnapshot (created/
    // updated) or just the engine id (deleted).
    ctx.services.messageBus.client.subscribe(CommandEventType.Created, async (msg: Msg) => {
      await withSpan(
        "woofwoofwoof.command.created",
        async () => {
          const payload = msg.json<CommandCreatedMessage>();
          const snapshot = payload?.data?.command;
          if (!snapshot) {
            return;
          }
          this.applyCommand(ctx, snapshotToCommand(snapshot));
        },
        { attributes: { "messaging.system": "nats" }, kind: SpanKind.CONSUMER }
      );
    });

    ctx.services.messageBus.client.subscribe(CommandEventType.Updated, async (msg: Msg) => {
      await withSpan(
        "woofwoofwoof.command.updated",
        async () => {
          const payload = msg.json<CommandUpdatedMessage>();
          const snapshot = payload?.data?.command;
          if (!snapshot) {
            return;
          }
          // If the command name changed, drop the old entry from the commander
          // first so we don't leave a phantom matcher behind.
          const previous = this.commandsByEngineId.get(snapshot.id);
          if (previous && previous.command !== snapshot.command && ctx.commander) {
            ctx.commander.remove(previous.command);
          }
          this.applyCommand(ctx, snapshotToCommand(snapshot));
        },
        { attributes: { "messaging.system": "nats" }, kind: SpanKind.CONSUMER }
      );
    });

    ctx.services.messageBus.client.subscribe(CommandEventType.Deleted, async (msg: Msg) => {
      await withSpan(
        "woofwoofwoof.command.deleted",
        async () => {
          const payload = msg.json<CommandDeletedMessage>();
          const id = payload?.data?.id;
          if (!id) {
            return;
          }
          this.removeCommandById(ctx, id);
        },
        { attributes: { "messaging.system": "nats" }, kind: SpanKind.CONSUMER }
      );
    });

    ctx.commander = commander;
  }

  async run(ctx: Context) {
    if (!ctx.commander) {
      throw new Error("Commander not set. This should never happen");
    }

    ctx.logger.info(chalk.yellow("#######################################################"));
    const channel = ctx.services.twitchChat.channel();
    ctx.logger.info(
      chalk.yellow.bold(
        channel ? `Connected to Twitch chat for channel: ${channel}` : "Twitch chat waiting for a Twitch link"
      )
    );
    ctx.logger.info(chalk.yellow("####################################################### \n"));

    const db = ctx.services.db.client;

    const commands = await db.listCommands({
      includeDisabled: false,
    });
    ctx.logger.info("after list commands");

    if (commands.status.code !== "OK") {
      ctx.logger.error("Failed to load commands", commands.status.message);
      throw new Error(`Failed to load commands: ${commands.status.message}`);
    }

    for (let i = 0; i < commands.commands.length; ++i) {
      this.applyCommand(ctx, commands.commands[i]);
    }

    // log every message
    ctx.commander.every(async (msg: string, user?: string) => {
      console.log("message", msg);
      ctx.logger.info(`${user} says: ${msg}`);
    });

    ctx.commander.add("grantcommands", async (text: string, _user?: string) => {
      await db.addUserToResource({
        username: text,
        resource: "command/*",
        role: "moderator",
      });
      return "";
    });

    ctx.commander.add("revokecommands", async (text: string, _user?: string) => {
      await db.removeUserFromResource({
        username: text,
        resource: "command/*",
        role: "moderator",
      });
      return "";
    });

    ctx.commander.add("vanish", async (_text: string, user?: string, _vars?: Record<string, unknown>, invocation?: CommandInvocation) => {
      const membership = invocation?.membership;
      if (membership?.isBroadcaster || membership?.isModerator) {
        return `@${user} is too important to vanish`;
      }
      // The id, because the name a chat message carries is the display name,
      // which is not always the login Twitch looks users up by.
      const chatterId = invocation?.chatterId;
      try {
        await this.requestTwitch(
          ctx,
          ctx.events.TwitchApi().timeout({
            ...(chatterId ? { userId: chatterId } : { userName: user }),
            durationSeconds: 1 + Math.floor(Math.random() * 600),
          })
        );
        return `/me *poof* @${user} is gone`;
      } catch (err) {
        return failureReply(`make @${user} vanish`, err);
      }
    });

    ctx.commander.add("follow", async (text: string) => {
      const username = text.replace("@", "").trim();
      const [topic, data] = ctx.events.Slobs().follow({ username });
      ctx.services.messageBus.client.publish(topic, data);
      return "";
    });

    ctx.commander.add(
      "category",
      async (text: string) => {
        if (!text) {
          return "Usage: !category <category name>";
        }
        try {
          const result = await this.requestTwitch<UpdateStreamResult>(
            ctx,
            ctx.events.TwitchApi().updateStream({ category: text })
          );
          return `Stream category set to ${result.categoryName ?? text}`;
        } catch (err) {
          return failureReply("change the category", err);
        }
      },
      { allowRoles: CHANNEL_EDITOR_ROLES }
    );

    ctx.commander.add(
      "title",
      async (text: string) => {
        if (!text) {
          return "Usage: !title <new stream title>";
        }
        try {
          const result = await this.requestTwitch<UpdateStreamResult>(
            ctx,
            ctx.events.TwitchApi().updateStream({ title: text })
          );
          return `Stream title updated to: ${result.title ?? text}`;
        } catch (err) {
          return failureReply("change the title", err);
        }
      },
      { allowRoles: CHANNEL_EDITOR_ROLES }
    );

    ctx.commander.add(
      "marker",
      async (text: string) => {
        try {
          const marker = await this.requestTwitch<StreamMarkerResult>(
            ctx,
            ctx.events.TwitchApi().createMarker({ description: text || undefined })
          );
          return `Stream marker placed at ${formatStreamPosition(marker.positionSeconds)}`;
        } catch (err) {
          return failureReply("place a marker", err);
        }
      },
      { allowRoles: CHANNEL_EDITOR_ROLES }
    );

    ctx.commander.add("sc", async (text: string) => {
      let sceneName = "";
      switch (text) {
        case "1":
          sceneName = "Chat";
          break;
        case "2":
          sceneName = "Programming";
          break;
        case "3":
          sceneName = "StreamTogether";
          break;
        case "4":
          sceneName = "";
          break;
      }

      if (!sceneName) {
        return "Scene does not exist";
      }

      const [topic, data] = ctx.events.Slobs().sceneChange({ sceneName });
      ctx.services.messageBus.client.publish(topic, data);
      return "Updated Scene";
    });

    ctx.commander.add("src", async (text: string) => {
      if (!text) {
        return "";
      }

      let visibility = false;
      const [sourceName, onoff] = text.split(" ");

      if (onoff === "on" || onoff === "1") {
        visibility = true;
      }

      const [topic, data] = ctx.events.Slobs().sourceChange({
        sourceName,
        value: visibility ? "on" : "off",
      });
      ctx.services.messageBus.client.publish(topic, data);
      return `Updating source: ${sourceName}`;
    });

    // add a command for updating the timer
    ctx.commander.add("time", async (msg: string) => {
      const time = msg;
      const [topic, data] = ctx.events.Slobs().notifyWidget({
        widgetId: "49b3fa3b-5eeb-40c3-bdc2-4d0e97192391",
        message: "setTime",
        data: {
          timerId: "49b3fa3b-5eeb-40c3-bdc2-4d0e97192391",
          valueInSeconds: parseTime(time),
        },
      });

      ctx.services.messageBus.client.publish(topic, data);

      return "Timer updated";
    });
  }

  async terminate(_ctx: Context) {}

  /**
   * Ask the twitch service to run a command and wait for its answer, so a
   * built-in command can tell the chatter whether it worked. Rejects with
   * the service's own error when it refused.
   */
  private async requestTwitch<T = unknown>(ctx: Context, [subject, data]: [string, Uint8Array]): Promise<T> {
    let reply: { data: Uint8Array };
    try {
      reply = await ctx.services.messageBus.client.request(subject, data, { timeout: TWITCH_REQUEST_TIMEOUT_MS });
    } catch (err) {
      throw toTwitchRequestError(err);
    }
    const envelope = JSON.parse(new TextDecoder().decode(reply.data)) as { type?: string; data?: unknown };
    if (envelope.type === TWITCH_ERROR_TYPE) {
      const error = (envelope.data as { error?: unknown } | undefined)?.error;
      throw new Error(typeof error === "string" ? error : "the Twitch service refused the request");
    }
    return envelope.data as T;
  }

  // Register or replace a command on the commander, and remember it under
  // its engine id so a later `command.deleted` (id-only) can resolve back
  // to the command name we registered.
  private applyCommand(ctx: Context, command: Command) {
    if (!ctx.commander) {
      throw new Error("Commander is undefined. This should never happen");
    }

    ctx.logger.info("applying command", command.command);
    const variables = parseCommandVariables(command.argumentPattern);
    const commanderOpts = {
      visibility: command.visibility === "public" ? ("public" as const) : ("restricted" as const),
      cooldownSeconds: command.cooldown,
      variables,
    };

    const actions = parseCommandActions(command, ctx);
    if (actions.length === 0) {
      // Nothing to run. The command still matches, and still announces itself
      // on chat.command.<slug> for workflows listening to it.
      ctx.commander.add(command.command, "", commanderOpts);
    } else {
      ctx.commander.add(
        command.command,
        async (
          text: string,
          user?: string,
          vars?: Record<string, unknown>,
          invocation?: { rawMessage: string; args: string[] }
        ) => {
          // The same ChatCommandEventData the CloudEvent carries, so an action
          // reading `${trigger.data.chatter}` sees what a workflow triggered by
          // this command sees.
          const eventData = {
            command: command.command,
            rawMessage: invocation?.rawMessage ?? text,
            text,
            args: invocation?.args ?? [],
            variables: vars ?? {},
            chatter: user ?? "",
            platform: "twitch" as const,
          };
          const [topic, payload] = ctx.events.Action().execute({
            label: `command:${command.command}`,
            actions,
            event: {
              id: crypto.randomUUID(),
              type: `chat.command.${commandNameToSubjectSegment(command.command)}`,
              source: "woofwoofwoof",
              time: new Date().toISOString(),
              data: eventData,
            },
          });
          try {
            await ctx.services.messageBus.client.publish(topic, payload);
          } catch (err) {
            ctx.logger.error("Failed to dispatch command actions", {
              command: command.command,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          // Nothing to say from here: a command that answers in chat does it
          // with a chat.reply action, which the engine runs like any other.
          return "";
        },
        commanderOpts
      );
    }

    this.commandsByEngineId.set(command.id, command);
  }

  private removeCommandById(ctx: Context, id: string) {
    if (!ctx.commander) {
      return;
    }
    const existing = this.commandsByEngineId.get(id);
    if (!existing) {
      return;
    }
    ctx.commander.remove(existing.command);
    this.commandsByEngineId.delete(id);
    ctx.logger.info("removed command", existing.command);
  }
}

// A command's actions as stored: JSON text, the same way a workflow stores its
// steps. Unreadable JSON runs nothing rather than taking the command down with
// it -- the command still matches and still fires its trigger event.
function parseCommandActions(command: Command, ctx: Context): ActionStep[] {
  if (!command.actionsJson) {
    return [];
  }
  try {
    const parsed = JSON.parse(command.actionsJson);
    return Array.isArray(parsed) ? (parsed as ActionStep[]) : [];
  } catch (err) {
    ctx.logger.error("Command actions are not readable JSON", {
      command: command.command,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// Bridge the engine's CommandSnapshot (shared API shape) into the
// protobuf Command shape that applyCommand expects. The two diverge only
// in fields applyCommand doesn't read (createdAt, createdBy*); we fill
// them with zero values so a round-trip stays type-safe.
function snapshotToCommand(snapshot: {
  id: string;
  command: string;
  actions: ActionStep[];
  cooldown: number;
  priority: number;
  enabled: boolean;
  visibility: string;
  groupIds: string[];
  usernames: string[];
  argumentPattern: string;
}): Command {
  return {
    id: snapshot.id,
    command: snapshot.command,
    actionsJson: JSON.stringify(snapshot.actions ?? []),
    cooldown: snapshot.cooldown,
    priority: snapshot.priority,
    enabled: snapshot.enabled,
    createdAt: { seconds: 0n, nanos: 0 },
    createdByType: "",
    createdByRef: "",
    visibility: snapshot.visibility,
    groupIds: snapshot.groupIds,
    usernames: snapshot.usernames,
    argumentPattern: snapshot.argumentPattern,
  };
}
