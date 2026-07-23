import type { ChatSayMessageAttributes } from "@twurple/chat";
import { extractCommandVariables } from "@woofx3/common/templates/command-variables";
import { resolve, type ResolverContext } from "@woofx3/common/templates/resolver";
import type { ChatClient } from "@woofx3/twitch";

export type CommandVisibility = "public" | "restricted";

export interface Command {
  action: string;
  command: string;
  response: CommandResponse;
  /** "public" always allows any user, skipping the auth check entirely.
   * Defaults to "restricted" when omitted. */
  visibility?: CommandVisibility;
  /** Seconds between invocations; 0 or undefined = never throttle. */
  cooldownSeconds?: number;
  /** Epoch ms of the last successful (non-throttled) invocation, per
   * command - not per user. */
  lastInvokedAt?: number;
  /** Ordered "{variable}" names parsed from the command's declared
   * argument_pattern (see command-variables.ts). Empty/undefined = the
   * command takes no named arguments (today's default behavior). */
  variables?: string[];
}

export type ChatWatcherFunction = (msg: string, user?: string) => Promise<void>;

/**
 * `vars` (third param, function responses only) carries the named argument
 * values extracted from the message per `Command.variables` - e.g. a
 * command declared as "sr {songTitle}" invoked as "!sr Life is a highway"
 * passes `{ songTitle: "Life is a highway" }`. Empty object when the
 * command declares no `{variable}` placeholders.
 *
 * `invocation` (fourth param, function responses only) carries the full
 * raw message and positional args that `msg` (the command-stripped
 * remainder) doesn't — needed by callers that forward a complete
 * `ChatCommandEventData`-shaped payload elsewhere (e.g. a direct barkloader
 * invoke). Every other handler can ignore it.
 */
export type CommandResponse =
  | string
  | ((
      msg: string,
      user?: string,
      vars?: Record<string, unknown>,
      invocation?: { rawMessage: string; args: string[] }
    ) => Promise<string>);

export type AuthorizationResponse = {
  granted: boolean;
  message?: string;
};
export type AuthorizationFunction = (user: string, command: string) => Promise<AuthorizationResponse>;

// Hook for emitting a `chat.command.<slug>` CloudEvent when a command matches.
// Keeps `Commands` decoupled from EventFactory and the message bus so tests can
// stub the publisher without wiring real transports.
export interface CommandMatch {
  commandName: string;
  args: string[];
  rawMessage: string;
  /** rawMessage with the matched command token stripped. */
  text: string;
  /** Named argument_pattern captures — see extractCommandVariables. Empty
   *  object when the command declares no `{variable}` placeholders. */
  variables: Record<string, unknown>;
  chatter: string;
}
export type CommandPublisher = (match: CommandMatch) => void;

export interface CommandsOptions {
  publisher?: CommandPublisher;
  onPublishError?: (err: unknown, match: CommandMatch) => void;
}

export class Commands {
  commands: Command[] = [];
  watchers: ChatWatcherFunction[] = [];
  auth: AuthorizationFunction;
  private publisher?: CommandPublisher;
  private onPublishError?: (err: unknown, match: CommandMatch) => void;

  constructor(
    private channel: string,
    private chatClient: ChatClient,
    opts?: CommandsOptions
  ) {
    this.auth = async (_user, _cmd) => ({ granted: true });
    this.publisher = opts?.publisher;
    this.onPublishError = opts?.onPublishError;
  }

  add(
    command: string,
    response: CommandResponse,
    opts?: { visibility?: CommandVisibility; cooldownSeconds?: number; variables?: string[] }
  ) {
    const cmd = this.commands.find((cmd) => cmd.command === command);

    if (cmd) {
      cmd.response = response;
      cmd.visibility = opts?.visibility;
      cmd.cooldownSeconds = opts?.cooldownSeconds;
      cmd.variables = opts?.variables;
      // lastInvokedAt is deliberately preserved across an update so a
      // hot-reloaded command's cooldown survives the edit.
      return;
    }

    this.commands.push({
      action: `!${command}`,
      command,
      response,
      visibility: opts?.visibility,
      cooldownSeconds: opts?.cooldownSeconds,
      variables: opts?.variables,
    });
  }

  // Remove a command by name. No-op if it doesn't exist; callers that
  // care about presence should check first.
  remove(command: string) {
    const idx = this.commands.findIndex((cmd) => cmd.command === command);
    if (idx === -1) {
      return;
    }
    this.commands.splice(idx, 1);
  }

  every(cb: ChatWatcherFunction) {
    this.watchers.push(cb);
  }

  async process(text: string, user: string): Promise<[string, boolean]> {
    const chatMsg = text.trim();

    this.watchers.forEach((w) => this.try(() => w(chatMsg, user)));

    // TODO: FIX: This outer loop is being called for every msg
    // can probably cache as a map
    for (let i = 0; i < this.commands.length; ++i) {
      const cmdRecord = this.commands[i];
      const { action, response } = cmdRecord;
      if (!text.length || text[0] != "!") {
        return ["", false];
      }

      let msg = this.parseAction(text);

      if (msg.action === action) {
        // Cooldown gates everything, including the emitted CloudEvent - a
        // throttled invocation is fully dropped (requirement: "drop any
        // invocations that happen within the cooldown period"), so it must
        // not trigger any workflow subscribed to this command either.
        if (cmdRecord.cooldownSeconds && cmdRecord.cooldownSeconds > 0) {
          const now = Date.now();
          if (cmdRecord.lastInvokedAt && now - cmdRecord.lastInvokedAt < cmdRecord.cooldownSeconds * 1000) {
            return ["", false];
          }
          cmdRecord.lastInvokedAt = now;
        }

        const auth =
          cmdRecord.visibility === "public" ? { granted: true } : await this.checkPermissions(user, msg.cmd);
        if (!auth.granted) {
          return [auth.message ?? "", !!auth.message];
        }

        // vars must be computed before emitMatch so the emitted CloudEvent
        // carries the same argument_pattern captures a module function sees.
        const args = msg.text.length > 0 ? msg.text.split(/\s+/) : [];
        const vars = extractCommandVariables(cmdRecord.variables ?? [], msg.text);

        // Emit the chat.command.<slug> CloudEvent before running the handler so
        // downstream consumers (e.g. workflow engine triggers) still observe the
        // match even if the handler throws or returns an empty string.
        this.emitMatch({
          commandName: msg.cmd,
          args,
          rawMessage: text,
          text: msg.text,
          variables: vars,
          chatter: user,
        });

        if (typeof response === "string") {
          const templateCtx: ResolverContext = {
            ...vars,
            user,
            args,
            argsText: msg.text,
            rawMessage: text,
            command: msg.cmd,
          };
          const resolved = resolve(response, templateCtx);
          return [typeof resolved === "string" ? resolved : String(resolved ?? ""), true];
        }
        if (typeof response === "function") {
          const res = await response(msg.text, user.trim(), vars, { rawMessage: text, args });
          return [res, true];
        }
      }
    }
    return ["", false];
  }

  parseAction(text: string) {
    const spaceidx = text.indexOf(" ");
    if (spaceidx === -1) {
      return {
        action: text.trim(),
        cmd: text.slice(1).trim(),
        text: "",
      };
    }

    return {
      action: text.slice(0, spaceidx).trim(), // full command with !
      cmd: text.slice(1, spaceidx).trim(), // command (wihout !)
      text: text.slice(spaceidx + 1).trim(), // text following command
    };
  }

  async send(msg: string, opts?: ChatSayMessageAttributes, parseCommand = false) {
    if (parseCommand) {
      let [message, matched] = await this.process(msg, this.channel);
      if (matched && message) {
        await this.chatClient.say(this.channel, msg, opts);
      }
    } else {
      await this.chatClient.say(this.channel, msg, opts);
    }
  }

  try(f: any) {
    try {
      f();
    } catch (err) {}
  }

  // Isolate publisher failures from command dispatch. A malformed command name
  // (e.g. one that slipped past UI validation) would throw inside the slug
  // helper, and we must not let that break the normal handler chain.
  private emitMatch(match: CommandMatch) {
    if (!this.publisher) {
      return;
    }
    try {
      this.publisher(match);
    } catch (err) {
      if (this.onPublishError) {
        this.onPublishError(err, match);
        return;
      }
      console.error("Failed to publish chat.command event", match.commandName, err);
    }
  }

  async checkPermissions(user: string, cmd: string) {
    return await this.auth(user, cmd);
  }

  setAuth(authFunc: AuthorizationFunction) {
    this.auth = authFunc;
  }
}
