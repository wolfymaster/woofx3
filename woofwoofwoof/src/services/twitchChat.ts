import type { Service } from "@woofx3/common/runtime";
import TwitchClient, {
  type ChatClient,
  type GetSettingFn,
  type RequestDashboardToken,
  type SetSettingFn,
  type TwitchAuthCredentials,
  type TwitchClientLogger,
} from "@woofx3/twitch";
import type { ChatSayMessageAttributes, ChatSender } from "../commands";
import { guardOutgoingLine, type SentLineRegistry } from "../sentLines";

/**
 * The error name TwitchClient.init rejects with while no Twitch account is
 * linked. Must match TWITCH_NOT_LINKED in shared/clients/typescript/twitch;
 * not imported, because tests replace that module with a default-only mock.
 */
const TWITCH_NOT_LINKED = "TwitchNotLinked";

export interface TwitchChatConfig {
  /**
   * The channel to join. Optional: without it the bot joins the channel of
   * whoever linked Twitch, so it can start before any account is linked.
   */
  channel?: string;
  /**
   * The engine's own Twitch app, for refreshing tokens itself. Absent when
   * the token comes from a dashboard, which `requestToken` asks instead.
   */
  credentials?: TwitchAuthCredentials;
  requestToken: RequestDashboardToken;
  getSetting: GetSettingFn;
  setSetting?: SetSettingFn;
  /** Where every line the bot says is recorded, so its echo can be recognised. */
  sentLines: SentLineRegistry;
  logger: TwitchClientLogger;
}

/**
 * Twitch chat for the bot.
 *
 * Until a Twitch account is linked there is nothing to connect to, so
 * `connect` leaves the service waiting -- healthy, but not connected --
 * instead of failing, and `reload` (on a token update) connects it later.
 */
export default class TwitchChatClientService implements Service<ChatClient>, ChatSender {
  healthcheck: boolean;
  name: string;
  type: string;
  client!: ChatClient;
  connected: boolean;
  /** True while no Twitch account is linked. */
  waitingForLink: boolean;
  private config: TwitchChatConfig;
  private joinedChannel: string | null = null;
  /** The Twitch user id the bot says its lines as, or null when it cannot speak. */
  private speakerId: string | null = null;

  constructor(config: TwitchChatConfig) {
    this.healthcheck = false;
    this.name = "twitchchat";
    this.type = "twitchchat";
    this.connected = false;
    this.waitingForLink = false;
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    const twitchClient = new TwitchClient({
      channel: this.config.channel,
      getSetting: this.config.getSetting,
      setSetting: this.config.setSetting,
      requestToken: this.config.requestToken,
      logger: this.config.logger,
    });

    const authProvider = await twitchClient.init(this.config.credentials).catch((err: unknown) => {
      if (err instanceof Error && err.name === TWITCH_NOT_LINKED) {
        return null;
      }
      throw err;
    });
    if (authProvider === null) {
      this.waitingForLink = true;
      this.healthcheck = true;
      return;
    }

    const channel = this.config.channel || (await twitchClient.broadcaster()).name;
    // The chat client says its lines with the token the provider hands out for
    // the chat intent, so that token's user is who the bot speaks as. That is
    // the linked account, which is not the joined channel's owner when a
    // channel is configured.
    if (!authProvider.getAccessTokenForIntent) {
      throw new Error("Twitch chat needs an auth provider that hands out tokens by intent");
    }
    // Without the speaker's id the bot's own lines could not be told apart
    // from the broadcaster's, and its echoes would run as commands.
    const chatToken = await authProvider.getAccessTokenForIntent("chat");
    if (!chatToken?.userId) {
      throw new Error("Twitch chat has no token for the chat intent naming the user it speaks as");
    }
    this.client = twitchClient.ChatClient(channel);
    this.client.connect();
    this.joinedChannel = channel;
    this.speakerId = chatToken.userId;
    this.waitingForLink = false;
    this.connected = true;
    this.healthcheck = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }
    this.client.quit();
    this.joinedChannel = null;
    this.speakerId = null;
    this.connected = false;
    this.healthcheck = false;
  }

  /**
   * Reload the chat client by tearing down the current connection and
   * reconnecting with a freshly-read `twitch_token` setting. Triggered
   * by the `setting.integration.token.updated` NATS event, so a Twitch link
   * or relink in the UI (which writes a new token and scopes to engine
   * settings) takes effect without restarting woofwoofwoof.
   */
  async reload(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  channel(): string | null {
    return this.connected ? this.joinedChannel : null;
  }

  async say(text: string, opts?: ChatSayMessageAttributes): Promise<void> {
    if (!this.connected || this.joinedChannel === null) {
      throw new Error("Twitch chat is not connected: link a Twitch account to send chat messages");
    }
    const line = guardOutgoingLine(text);
    // Recorded before sending: the echo can arrive on the chat feed before
    // `say` resolves. A line whose send fails simply expires unclaimed.
    this.config.sentLines.record(line);
    await this.client.say(this.joinedChannel, line, opts);
  }

  /**
   * True when a chat message is the echo of a line the bot said: it comes
   * from the account the bot speaks as and matches an unclaimed recent line.
   * Claims that line, so it answers for one echo only.
   */
  consumeOwnEcho(chatterId: string, text: string): boolean {
    if (this.speakerId === null || chatterId !== this.speakerId) {
      return false;
    }
    return this.config.sentLines.consume(text);
  }
}
