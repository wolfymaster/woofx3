# WoofWoofWoof

Twitch chatbot service that listens to messages, processes commands, and integrates with external services

## Overview

This service consists of the following modules:

- **application** - woofwoofwoof/src/application.ts
- **commands** - woofwoofwoof/src/commands.ts
- **config** - woofwoofwoof/src/config.ts
- **boostrap** - woofwoofwoof/src/boostrap.ts
- **messageBus** - woofwoofwoof/src/services/messageBus.ts
- **barkloader** - woofwoofwoof/src/services/barkloader.ts
- **twitchChat** - woofwoofwoof/src/services/twitchChat.ts

## API Reference

| Name | Type | Description |
|------|------|-------------|
| WoofWoofWoof | class |  |
| WoofWoofWoofServices | type |  |
| WoofWoofWoofContextArgs | type |  |
| WoofWoofWoofContext | type |  |
| WoofWoofWoofApplication | type |  |
| Commands | class |  |
| Command | interface |  |
| ChatWatcherFunction | type |  |
| CommandResponse | type |  |
| AuthorizationResponse | type |  |
| AuthorizationFunction | type |  |
| WoofEnvConfig | type |  |
| Bootstrap | function |  |
| AppConfig | type |  |
| MessageBusService | class |  |
| BarkloaderClientService | class |  |
| TwitchChatClientService | class |  |
