import type { ChatSayMessageAttributes } from "@twurple/chat";
import type { ChatClient } from "@woofx3/twitch";

export interface Command {
  action: string;
  command: string;
  response: CommandResponse;
}

export type ChatWatcherFunction = (msg: string, user?: string) => Promise<void>;

export type CommandResponse = string | ((msg: string, user?: string) => Promise<string>);

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

  add(command: string, response: CommandResponse) {
    const cmd = this.commands.find((cmd) => cmd.command === command);

    if (cmd) {
      cmd.response = response;
      return;
    }

    this.commands.push({
      action: `!${command}`,
      command,
      response,
    });
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
      const { action, response } = this.commands[i];
      if (!text.length || text[0] != "!") {
        return ["", false];
      }

      let msg = this.parseAction(text);

      if (msg.action === action) {
        const auth = await this.checkPermissions(user, msg.cmd);
        if (!auth.granted) {
          return [auth.message ?? "", !!auth.message];
        }

        // Emit the chat.command.<slug> CloudEvent before running the handler so
        // downstream consumers (e.g. workflow engine triggers) still observe the
        // match even if the handler throws or returns an empty string.
        this.emitMatch({
          commandName: msg.cmd,
          args: msg.text.length > 0 ? msg.text.split(/\s+/) : [],
          rawMessage: text,
          chatter: user,
        });

        if (typeof response === "string") {
          return [response, true];
        }
        if (typeof response === "function") {
          const res = await response(msg.text, user.trim());
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
