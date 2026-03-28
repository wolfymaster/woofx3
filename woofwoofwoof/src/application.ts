import type { BarkloaderMessageResponse } from "@woofx3/barkloader";
import EventFactory from "@woofx3/common/cloudevents/EventFactory";
import { type ChatMessageMessage, EventType } from "@woofx3/common/cloudevents/Twitch";
import type { ApplicationContext } from "@woofx3/common/runtime";
import type { Application, IApplication } from "@woofx3/common/runtime/application";
import { type Command, ListCommands } from "@woofx3/db/command.pb";
import { AddUserToResource, RemoveUserFromResource } from "@woofx3/db/permission.pb";
import type { Msg } from "@woofx3/nats/src/types";
import chalk from "chalk";
import { Commands } from "./commands";
import type BarkloaderClientService from "./services/barkloader";
import type MessageBusService from "./services/messageBus";
import type TwitchChatClientService from "./services/twitchChat";
import Spotify from "./spotify";
import { canUse, parseTime } from "./util";

type Context = ApplicationContext<WoofWoofWoofContext, WoofWoofWoofServices>;

export type WoofWoofWoofServices = {
  barkloader: BarkloaderClientService;
  messageBus: MessageBusService;
  twitchChat: TwitchChatClientService;
};

// Full context type - with typed services
export type WoofWoofWoofContext = {
  commander?: Commands;
  events: EventFactory;
};

export type WoofWoofWoofApplication = Application<Context, WoofWoofWoofServices>;

export default class WoofWoofWoof implements IApplication<WoofWoofWoofContext, WoofWoofWoofServices> {
  readonly context: WoofWoofWoofContext;
  // Type marker for final context - used only for type inference, never accessed at runtime
  readonly __finalContextType!: WoofWoofWoofContext;

  constructor() {
    this.context = {
      events: new EventFactory({ source: "woofwoofwoof" }),
    };
  }

  async init(ctx: Context) {
    const databaseProxyUrl = (ctx.config.getConfig("woofx3DatabaseProxyUrl") as string) ?? "";

    const commander = new Commands(
      ctx.config.getConfig("woofx3TwitchChannelName") as string,
      ctx.services.twitchChat.client
    );
    commander.setAuth(async (user: string, cmd: string) => {
      return await canUse(user, cmd, databaseProxyUrl);
    });

    // register message handler for barkloader
    ctx.services.barkloader.client.registerHandler("onMessage", (message: BarkloaderMessageResponse) => {
      ctx.logger.info("recived on socket", message);
      try {
        if (message.error) {
          ctx.logger.error(message);
          return;
        }
        if (message.command && ctx.commander) {
          ctx.commander.send(message.args.message, {}, false);
        }
      } catch {
        ctx.logger.error("failed to parse websocket message as json");
      }
    });

    // subscribe to chat message events
    ctx.services.messageBus.client.subscribe(EventType.ChatMessage, async (msg: Msg) => {
      const payload = msg.json<ChatMessageMessage>();
      const [message, matched] = await commander.process(payload.data.message, payload.data.chatterName);
      if (matched && message) {
        await commander.send(message);
      }
    });
    ctx.commander = commander;
  }

  async run(ctx: Context) {
    if (!ctx.commander) {
      throw new Error("Commander not set. This should never happen");
    }

    ctx.logger.info(chalk.yellow("#######################################################"));
    ctx.logger.info(
      chalk.yellow.bold(`Connected to Twitch chat for channel: ${ctx.config.getConfig("woofx3TwitchChannelName")}`)
    );
    ctx.logger.info(chalk.yellow("####################################################### \n"));

    const applicationId = ctx.config.getConfig("applicationId") as string;
    const databaseProxyUrl = ctx.config.getConfig("woofx3DatabaseProxyUrl") as string;
    const dbClientConfig = { baseURL: databaseProxyUrl };

    const commands = await ListCommands(
      {
        applicationId,
        includeDisabled: false,
      },
      dbClientConfig
    );
    ctx.logger.info("after list commands");

    if (commands.status.code !== "OK") {
      ctx.logger.error("Failed to load commands", commands.status.message);
      throw new Error(`Failed to load commands: ${commands.status.message}`);
    }

    // TODO: Handle hot reloading of commands
    for (let i = 0; i < commands.commands.length; ++i) {
      this.addCommand(ctx, commands.commands[i]);
    }

    // log every message
    ctx.commander.every(async (msg: string, user?: string) => {
      console.log("message", msg);
      ctx.logger.info(`${user} says: ${msg}`);
    });

    ctx.commander.add("grantcommands", async (text: string, user?: string) => {
      await AddUserToResource(
        {
          applicationId,
          username: text,
          resource: "command/*",
          role: "moderator",
        },
        dbClientConfig
      );
      return "";
    });

    ctx.commander.add("revokecommands", async (text: string, user?: string) => {
      await RemoveUserFromResource(
        {
          applicationId,
          username: text,
          resource: "command/*",
          role: "moderator",
        },
        dbClientConfig
      );
      return "";
    });

    ctx.commander.add("vanish", async (text: string, user?: string) => {
      const [topic, data] = ctx.events.TwitchApi().timeout({
        user,
        duration: Math.floor(Math.random() * 600),
      });
      ctx.services.messageBus.client.publish(topic, data);
      return `/me *poof* @${user} is gone`;
    });

    ctx.commander.add("follow", async (text: string) => {
      const username = text.replace("@", "").trim();
      const [topic, data] = ctx.events.Slobs().follow({ username });
      ctx.services.messageBus.client.publish(topic, data);
      return "";
    });

    ctx.commander.add("song", async (text: string) => {
      const spotify = new Spotify(
        (ctx.config.getConfig("spotifyClientId") as string) ?? "",
        (ctx.config.getConfig("spotifyClientSecret") as string) ?? "",
        (ctx.config.getConfig("spotifyAccessToken") as string) ?? "",
        (ctx.config.getConfig("spotifyRefreshToken") as string) ?? ""
      );

      await spotify.refresh();

      const track = await spotify.currentTrack();

      return `Currently Playing: ${track.name} by ${track.artist}`;
    });

    ctx.commander.add("sr", async (text: string) => {
      const spotify = new Spotify(
        (ctx.config.getConfig("spotifyClientId") as string) ?? "",
        (ctx.config.getConfig("spotifyClientSecret") as string) ?? "",
        (ctx.config.getConfig("spotifyAccessToken") as string) ?? "",
        (ctx.config.getConfig("spotifyRefreshToken") as string) ?? ""
      );

      // await spotify.refresh();

      // list devices
      // console.log(await spotify.devices());

      await spotify.refresh();

      // const devices = await spotify.devices();
      // console.log('devices', devices);

      // select a song and play it via spotify
      const deviceId = "02e7cb6b8d5bae01eeb82eb2af0e32e22e044d43"; // computer device id

      // if url, attempt to parse
      if (text.includes("open.spotify.com/track")) {
        const regex = /(?:https?:\/\/)?open\.spotify\.com\/track\/([a-zA-Z0-9]+)(?:\?|$)/;

        const matches = text.match(regex);
        if (!matches || matches.length < 2) {
          return "";
        }

        const trackId = matches[1];

        const song = await spotify.getTrack(trackId);

        // await spotify.addToPlaylist(song);
        await spotify.play(song, deviceId);

        return `Added to queue: ${song.name} by ${song.artist}`;
      }

      const results = await spotify.search(text);

      // search spotify "smartly"
      const firstResult = results[0];

      // await spotify.addToPlaylist(firstResult);
      await spotify.play(firstResult, deviceId);

      return `Added to queue: ${firstResult.name} by ${firstResult.artist}`;
    });

    // UPDATE STREAM CATEGORY
    ctx.commander.add("category", async (text: string) => {
      const twitchApi = ctx.events.TwitchApi();
      switch (text) {
        case "sgd": {
          const [t1, d1] = twitchApi.updateStream({ category: "software and game development" });
          ctx.services.messageBus.client.publish(t1, d1);
          return "Updating stream category to Software and Game Development";
        }
        case "jc": {
          const [t2, d2] = twitchApi.updateStream({ category: "just chatting" });
          ctx.services.messageBus.client.publish(t2, d2);
          return "Updating stream category to Just Chatting";
        }
        case "irl": {
          const [t3, d3] = twitchApi.updateStream({ category: "irl" });
          ctx.services.messageBus.client.publish(t3, d3);
          return "Updating stream category to IRL";
        }
        case "apex": {
          const [t4, d4] = twitchApi.updateStream({ category: "apex legends" });
          ctx.services.messageBus.client.publish(t4, d4);
          return "Updating stream category to Apex";
        }
        default:
          console.error("INVALID TWITCH CATEGORY");
      }

      return "";
    });

    // UPDATE STREAM TITLE
    ctx.commander.add("title", async (text: string, user?: string) => {
      if (!user || user.toLowerCase() !== "wolfymaster") {
        return "Sorry, @cyburdial ruined this for everyone.";
      }
      const [topic, data] = ctx.events.TwitchApi().updateStream({ title: text });
      ctx.services.messageBus.client.publish(topic, data);
      return `Stream title updated to: ${text}`;
    });

    ctx.commander.add("sc", async (text: string) => {
      let sceneName = "";
      switch (text) {
        case "1":
          sceneName = "Chat";
          break;
        case "2":
          sceneName = "Programming";
          break;
        case "3":
          sceneName = "StreamTogether";
          break;
        case "4":
          sceneName = "";
          break;
      }

      if (!sceneName) {
        return "Scene does not exist";
      }

      const [topic, data] = ctx.events.Slobs().sceneChange({ sceneName });
      ctx.services.messageBus.client.publish(topic, data);
      return "Updated Scene";
    });

    ctx.commander.add("src", async (text: string) => {
      if (!text) {
        return "";
      }

      let visibility = false;
      const [sourceName, onoff] = text.split(" ");

      if (onoff === "on" || onoff === "1") {
        visibility = true;
      }

      const [topic, data] = ctx.events.Slobs().sourceChange({
        sourceName,
        value: visibility ? "on" : "off",
      });
      ctx.services.messageBus.client.publish(topic, data);
      return `Updating source: ${sourceName}`;
    });

    // add a command for updating the timer
    ctx.commander.add("time", async (msg: string) => {
      const time = msg;
      const [topic, data] = ctx.events.Slobs().notifyWidget({
        widgetId: "49b3fa3b-5eeb-40c3-bdc2-4d0e97192391",
        message: "setTime",
        data: {
          timerId: "49b3fa3b-5eeb-40c3-bdc2-4d0e97192391",
          valueInSeconds: parseTime(time),
        },
      });

      ctx.services.messageBus.client.publish(topic, data);

      return "Timer updated";
    });
  }

  async terminate(_ctx: Context) {}

  // Add a new command
  private addCommand(ctx: Context, command: Command) {
    if (!ctx.commander) {
      throw new Error("Commander is undefined. This should never happen");
    }

    // TODO: add "eval" type for inline evaluation like:
    //      - !setcommand hello eval {caller} says hello to {targetUser[0]}!
    // need to be able to eval the caller or any number of tagged users: !hello @userA @userB
    ctx.logger.info("adding command", command.command);
    if (command.type === "function") {
      ctx.commander.add(command.command, async (text: string, user?: string) => {
        try {
          ctx.services.barkloader.client.send(
            JSON.stringify({
              type: "invoke",
              data: {
                func: command.command,
                args: [text, user],
              },
            })
          );
        } catch (err: unknown) {
          if (err instanceof Error) {
            console.error("Failed to send message to Barkloader", err.message);
          } else {
            console.error("Failed to send message to Barkloader", err);
          }
        }
        return "";
      });
      return;
    }
    ctx.commander.add(command.command, command.typeValue);
  }
}
