import { PLATFORM_GATEWAY_SUBJECTS } from "@woofx3/api/platform-gateway";
import { EventType as ActionEventType } from "@woofx3/common/cloudevents/Action";
import type { ChatCommandEvent } from "@woofx3/common/cloudevents/Chat/commands";
import { EventType as CommandEventType } from "@woofx3/common/cloudevents/Command";
import EventFactory from "@woofx3/common/cloudevents/EventFactory";
import { EventType as TwitchEventType } from "@woofx3/common/cloudevents/Twitch";
import { TWITCHAPI_SUBJECT } from "@woofx3/common/cloudevents/Twitch/commands";
import type { ChatConfig } from "../config/chat";
import { type Clock, errorMessage, type Logger, type Timers } from "../host/deps";
import type { ScopedBus, SubjectGrants } from "../host/scoped-bus";
import { CommandStore, storedCommandDefinition } from "./command-store";
import { type ChatReplier, type CommandDefinition, type CommandMatch, CommandTable } from "./commands";
import type { DispatcherDb, PermissionDecision } from "./db-client";
import { DerivedGroupSync } from "./derived-group-sync";
import { CommandPermissions, refusalReply } from "./permissions";
import { GatewayReplier } from "./replier";
import { type ChatLine, readChatLine } from "./trust";

/** The CloudEvent `source` of the `chat.command.<slug>` events the dispatcher announces. */
export const DISPATCHER_EVENT_SOURCE = "connectors";

/** The chat line subject every platform adapter publishes on; the platform is the event's `platform` attribute. */
export const CHAT_LINE_SUBJECT = TwitchEventType.ChatMessage;

/** Command lifecycle events, each only a signal to reload the table. */
export const COMMAND_EVENT_SUBJECTS = [CommandEventType.Created, CommandEventType.Updated, CommandEventType.Deleted];

/**
 * Every subject the dispatcher uses, for the grants of the scope it runs in.
 * Whoever starts it adds these to that scope.
 */
export const CHAT_DISPATCHER_GRANTS: SubjectGrants = {
  subscribes: [CHAT_LINE_SUBJECT, ...COMMAND_EVENT_SUBJECTS],
  publishes: ["chat.command.*", ActionEventType.Execute, CommandEventType.ExecuteWorkflow],
  requests: [PLATFORM_GATEWAY_SUBJECTS.send, TWITCHAPI_SUBJECT],
};

export type DispatcherBus = Pick<ScopedBus, "publish" | "subscribe" | "request">;

/** Sees every line the dispatcher acts on, before it is matched. */
export type LineWatcher = (line: ChatLine) => void | Promise<void>;

/**
 * How one line ended, for tests and logs:
 * - refused: not attributable to a speaker; from_engine: the engine's own line;
 * - no_command: names no command this platform runs;
 * - denied, cooling_down: matched but not run;
 * - failed: the permission check or the handler threw;
 * - ran: the handler ran.
 */
export type LineOutcome = "refused" | "from_engine" | "no_command" | "denied" | "cooling_down" | "failed" | "ran";

export interface ChatDispatcherDeps {
  config: ChatConfig;
  /** Created once by whoever builds the dispatcher, and shared by all its parts. */
  db: DispatcherDb;
  bus: DispatcherBus;
  builtins: readonly CommandDefinition[];
  clock: Clock;
  timers: Timers;
  logger: Logger;
  /** Defaults to replying through the platform gateway on `bus`. */
  replier?: ChatReplier;
}

/**
 * Runs chat commands for every platform. Each line goes through, in order:
 * the trust rules, the derived groups, the command match, who may run it,
 * the cooldown, and the handler; the handler's reply goes back through the
 * platform gateway to the line's own platform.
 */
export class ChatDispatcher {
  private readonly table: CommandTable;
  private readonly store: CommandStore;
  private readonly groups: DerivedGroupSync;
  private readonly permissions: CommandPermissions;
  private readonly replier: ChatReplier;
  private readonly events = new EventFactory({ source: DISPATCHER_EVENT_SOURCE });
  private readonly watchers: LineWatcher[] = [];
  private started = false;

  constructor(private readonly deps: ChatDispatcherDeps) {
    this.table = new CommandTable(deps.builtins, deps.clock);
    this.store = new CommandStore({
      config: deps.config.store,
      db: deps.db,
      table: this.table,
      define: (stored) =>
        storedCommandDefinition(
          stored,
          {
            runWorkflow: (workflowId, event) =>
              this.publish(this.events.Command().executeWorkflow({ workflowId, event })),
            runActions: (label, actions, event) =>
              this.publish(this.events.Action().execute({ label, actions, event })),
          },
          deps.logger
        ),
      timers: deps.timers,
      logger: deps.logger,
    });
    this.groups = new DerivedGroupSync(deps.db, deps.config.groups, deps.clock, deps.logger);
    this.permissions = new CommandPermissions(deps.db, deps.config.authCache, deps.clock);
    this.replier =
      deps.replier ?? new GatewayReplier({ bus: deps.bus, timeoutMs: deps.config.replyTimeoutMs, logger: deps.logger });
  }

  /** Adds a watcher. A watcher that throws is logged and never stops the line. */
  watch(watcher: LineWatcher): void {
    this.watchers.push(watcher);
  }

  /** Loads the commands, then subscribes. Throws when the first load fails, before any line is read. */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error("the chat dispatcher is already started");
    }
    this.started = true;
    // A command event in the moment between the first listing and these
    // subscriptions is missed; the store's backstop reload picks it up.
    await this.store.start();
    try {
      for (const subject of COMMAND_EVENT_SUBJECTS) {
        await this.deps.bus.subscribe(subject, () => this.store.requestReload());
      }
      await this.deps.bus.subscribe(CHAT_LINE_SUBJECT, async (msg) => {
        await this.handleLine(msg.data);
      });
    } catch (error) {
      // The backstop would otherwise keep reloading a table nothing reads.
      await this.store.stop();
      throw error;
    }
  }

  /** Stops reloading. The subscriptions belong to the scope, which its owner closes. */
  async stop(): Promise<void> {
    await this.store.stop();
  }

  /** Resolves once no command reload is running. For tests. */
  async settled(): Promise<void> {
    await this.store.idle();
  }

  async handleLine(data: Uint8Array): Promise<LineOutcome> {
    let envelope: unknown;
    try {
      envelope = JSON.parse(decoder.decode(data));
    } catch (error) {
      this.deps.logger.warn("a chat line is not JSON; ignored", { error: errorMessage(error) });
      return "refused";
    }
    const reading = readChatLine(envelope);
    if (reading.kind === "refused") {
      this.deps.logger.warn("a chat line was refused", { problem: reading.problem });
      return "refused";
    }
    if (reading.kind === "from_engine") {
      return "from_engine";
    }
    const line = reading.line;
    this.notifyWatchers(line);
    // Before the match, so membership granted on this line is in the groups by the time its permission is checked.
    if (line.trusted && !line.sharedChat && line.membership !== undefined) {
      await this.groups.reconcile(line.viewer, line.chatterLogin, line.membership);
    }
    const match = this.table.match(line.text, line.platform);
    if (match === null) {
      return "no_command";
    }
    return this.run(line, match);
  }

  private async run(line: ChatLine, match: CommandMatch): Promise<LineOutcome> {
    const { definition, call } = match;
    let decision: PermissionDecision;
    try {
      decision = await this.permissions.authorize(definition, call.name, line);
    } catch (error) {
      this.deps.logger.error("could not check who may run a chat command", {
        command: call.name,
        error: errorMessage(error),
      });
      return "failed";
    }
    // Who may run it comes before the cooldown, so a refused chatter neither
    // spends the cooldown for everyone else nor learns it is cooling down.
    if (decision === "denied") {
      await this.replier.reply(line, call.name, refusalReply(line));
      return "denied";
    }
    // A throttled invocation is dropped whole: no announcement, so no workflow listening for it runs either.
    if (!this.table.takeCooldown(definition)) {
      return "cooling_down";
    }
    let event: ChatCommandEvent;
    try {
      event = this.announce(line, match);
    } catch (error) {
      this.deps.logger.error("could not build a chat command's event; not run", {
        command: call.name,
        error: errorMessage(error),
      });
      return "failed";
    }
    let reply: string;
    try {
      reply = await definition.handler({
        line,
        commandName: call.name,
        text: call.text,
        args: match.args,
        variables: match.variables,
        event,
      });
    } catch (error) {
      this.deps.logger.error("a chat command failed", { command: call.name, error: errorMessage(error) });
      return "failed";
    }
    if (reply !== "") {
      await this.replier.reply(line, call.name, reply);
    }
    return "ran";
  }

  /**
   * Builds the invocation's event and starts announcing it on
   * chat.command.<slug>, before the handler runs, so a workflow listening for
   * the command sees the match even if the handler fails. A failed
   * announcement is logged and does not hold the handler up.
   */
  private announce(line: ChatLine, match: CommandMatch): ChatCommandEvent {
    const chatCommand = this.events.ChatCommand();
    const event = chatCommand.event(
      match.call.name,
      {
        args: match.args,
        rawMessage: line.text,
        text: match.call.text,
        variables: match.variables,
        chatter: line.chatterName,
        platform: line.platform,
      },
      { platform: line.platform, triggeredBy: line.platform }
    );
    const [subject, data] = chatCommand.encode(event);
    this.deps.bus.publish(subject, data).catch((error: unknown) => {
      this.deps.logger.error("could not announce a chat command", {
        command: match.call.name,
        error: errorMessage(error),
      });
    });
    return event;
  }

  private notifyWatchers(line: ChatLine): void {
    for (const watcher of this.watchers) {
      try {
        const watched = watcher(line);
        if (watched instanceof Promise) {
          watched.catch((error: unknown) => this.logWatcherError(error));
        }
      } catch (error) {
        this.logWatcherError(error);
      }
    }
  }

  private logWatcherError(error: unknown): void {
    this.deps.logger.error("a chat line watcher failed", { error: errorMessage(error) });
  }

  private async publish([subject, data]: [string, Uint8Array]): Promise<void> {
    await this.deps.bus.publish(subject, data);
  }
}

const decoder = new TextDecoder();
