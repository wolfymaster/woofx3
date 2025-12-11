import type { HelixUser } from "@twurple/api";
import EventFactory from "@woofx3/cloudevents/EventFactory";
import { mergeConfigWithEnvironment, readConfigFile } from "@woofx3/common/utils";
import MessageBus from "@woofx3/nats";
import type NATSClient from "@woofx3/nats/src/client";
import TwitchClient from "@woofx3/twitch";
import type { Logger } from "winston";
import * as twitch from './lib';
import TwitchApi from "./lib/twitch";
import TwitchEventBus from "./lib/twitchEventBus";
import type { Context } from "./types";

export async function Bootstrap(): Promise<AppConfig> {
  const logger = twitch.makeLogger({
    level: "info",
    defaultMeta: { service: "twitch" },
  });

  // read configuration
  const configurationFileContents = readConfigFile();
  // merge config with environment
  const configuration = mergeConfigWithEnvironment(configurationFileContents, process.env);

  // twitch channel
  const channel = configuration.twitchChannelName;
  if (!channel) {
    throw new Error("twitch channel missing. please set environment variable: TWITCH_CHANNEL_NAME.");
  }

  // connect to NATS
  const bus = await MessageBus.createMessageBus({
    name: "twitchapi",
    url: configuration.messageBusUrl,
    jwt: configuration.messageBusJwt,
    nkeySeed: configuration.messageBusNKey,
  });

  // Twitch client
  const twitchClient = new TwitchClient({
    applicationId: process.env.APPLICATION_ID || "",
    channel,
    databaseURL: process.env.DATABASE_PROXY_URL || "",
  });

  await twitchClient.init({
    clientId: process.env.TWITCH_WOLFY_CLIENT_ID || "",
    clientSecret: process.env.TWITCH_WOLFY_CLIENT_SECRET || "",
    redirectUri: process.env.TWITCH_REDIRECT_URL || "http://localhost",
  });

  const apiClient = twitchClient.ApiClient();
  const listener = twitchClient.EventBusListener();
  const broadcaster = await twitchClient.broadcaster();

  const ctx: Context = {
    broadcaster,
    logger,
    messageBus: bus,
    events: new EventFactory({ source: "twitch" }),
  };

  // Twitch Api instance
  const twitchApi = new TwitchApi(apiClient, broadcaster);
  // Twitch event bus
  const twitchEventBus = new TwitchEventBus(ctx, listener);

  return {
    broadcaster,
    logger,
    services: {
      messageBus: bus,
      twitchApi,
      twitchEventBus,
    },
  };
}

export type AppConfig = {
  broadcaster: HelixUser,
  logger: Logger,
  services: {
    messageBus: NATSClient;
    twitchApi: TwitchApi;
    twitchEventBus: TwitchEventBus;
  };
};
