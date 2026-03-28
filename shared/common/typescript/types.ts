export type MainConfigurationFile = {
  rootPath?: string;

  // Message Bus Values
  messagebusHost?: string;
  messagebusServerListeningPort?: number;
  messagebusUrl: string;
  messagebusJwt?: string;
  messagebusNKey?: string;

  // Twitch
  twitchChannelName?: string;

  [key: string]: string | undefined | number | boolean;
};
