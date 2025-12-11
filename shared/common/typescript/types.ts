export type MainConfigurationFile = {
  rootPath?: string;
  
  // Message Bus Values
  messageBusHost?: string;
  messageBusServerListeningPort?: number;
  messageBusUrl: string;
  messageBusJwt?: string;
  messageBusNKey?: string;

  // Twitch
  twitchChannelName?: string;

  [key: string]: string | undefined | number | boolean;
}
