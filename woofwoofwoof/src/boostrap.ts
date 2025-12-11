import BarkloaderClient from "@woofx3/barkloader";
import type { MainConfigurationFile } from "@woofx3/common/types";
import { mergeConfigWithEnvironment, readConfigFile } from "@woofx3/common/utils";
import MessageBus from "@woofx3/nats";
import type NATSClient from "@woofx3/nats/src/client";
import TwitchClient, { type ChatClient } from "@woofx3/twitch";

export default async function Bootstrap(): Promise<AppConfig> {
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
    name: "woofwooofwoof",
    url: configuration.messageBusUrl,
    jwt: configuration.messageBusJwt,
    nkeySeed: configuration.messageBusNKey,
  });

  // Get Twitch Client
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

  // create Twitch chat client
  const chatClient = twitchClient.ChatClient();

  // Barkloader websocket
  const barkloaderClient = new BarkloaderClient({
    wsUrl: process.env.WOOFX3_BARKLOADER_WS_URL || "",
    onOpen: (event) => {
      console.log("socket opened");
    },
    onClose: (event) => {
      console.log("socket closed");
    },
    onError: (event) => {
      console.log("socket error", event);
    },
    maxRetries: Infinity,
    onReconnectAttempt: () => {
      console.log("disconnecting.. attempting to reconnect");
    },
    reconnectTimeout: 5000, // 5 seconds
  });

  return {
    channelName: channel,
    config: configuration,
    services: {
      barkloaderClient,
      chatClient,
      messageBus: bus,
    }
  };
}

export type AppConfig = {
  channelName: string;
  config: MainConfigurationFile;
  services: {
    barkloaderClient: BarkloaderClient;
    chatClient: ChatClient;
    messageBus: NATSClient;  
  }
};
