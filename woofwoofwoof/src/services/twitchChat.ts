import type { Service } from "@woofx3/common/runtime";
import TwitchClient, {
  type ChatClient,
  type GetSettingFn,
  type SetSettingFn,
  type TwitchAuthCredentials,
} from "@woofx3/twitch";
import type { ChatSayMessageAttributes, ChatSender } from "../commands";

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
  credentials: TwitchAuthCredentials;
  getSetting: GetSettingFn;
  setSetting?: SetSettingFn;
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
    });

    try {
      await twitchClient.init(this.config.credentials);
    } catch (err) {
      if (err instanceof Error && err.name === TWITCH_NOT_LINKED) {
        this.waitingForLink = true;
        this.healthcheck = true;
        return;
      }
      throw err;
    }

    const channel = this.config.channel || (await twitchClient.broadcaster()).name;
    this.client = twitchClient.ChatClient(channel);
    this.client.connect();
    this.joinedChannel = channel;
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
    await this.client.say(this.joinedChannel, text, opts);
  }
}
