import BarkloaderClient from "@woofx3/barkloader";
import MessageBus from "@woofx3/nats";
import type NATSClient from "@woofx3/nats/src/client";
import TwitchClient, { type ChatClient } from "@woofx3/twitch";
import type { WoofEnvConfig } from "./config";

export default async function Bootstrap(config: WoofEnvConfig): Promise<AppConfig> {
  const channel = config.woofx3TwitchChannelName;

  const bus = await MessageBus.createMessageBus({
    name: "woofwooofwoof",
    url: config.woofx3MessagebusUrl,
    jwt: config.woofx3MessagebusJwt,
    nkeySeed: config.woofx3MessagebusNKey,
  });

  const twitchClient = new TwitchClient({
    applicationId: config.woofx3ApplicationId,
    channel,
    databaseURL: config.woofx3DatabaseProxyUrl,
  });

  await twitchClient.init({
    clientId: config.woofx3TwitchClientId,
    clientSecret: config.woofx3TwitchClientSecret,
    redirectUri: config.twitchRedirectUrl,
  });

  const chatClient = twitchClient.ChatClient();

  const barkloaderClient = new BarkloaderClient({
    wsUrl: `${config.woofx3BarkloaderWsUrl}?token=${config.woofx3BarkloaderKey}`,
    onOpen: () => {
      console.log("socket opened");
    },
    onClose: () => {
      console.log("socket closed");
    },
    onError: (event) => {
      console.log("socket error", event);
    },
    maxRetries: Infinity,
    onReconnectAttempt: () => {
      console.log("disconnecting.. attempting to reconnect");
    },
    reconnectTimeout: 5000,
  });

  return {
    channelName: channel,
    services: {
      barkloaderClient,
      chatClient,
      messageBus: bus,
    },
  };
}

export type AppConfig = {
  channelName: string;
  services: {
    barkloaderClient: BarkloaderClient;
    chatClient: ChatClient;
    messageBus: NATSClient;
  };
};
