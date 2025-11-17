import type { BarkloaderMessageResponse } from "@woofx3/barkloader";
import { type ChatMessageMessage, EventType } from "@woofx3/cloudevents/Twitch";
import type { Application, ApplicationClass, ServicesRegistry } from "@woofx3/common/runtime";
import { type Command, ListCommands } from "@woofx3/db/command.pb";
import { AddUserToResource, RemoveUserFromResource } from "@woofx3/db/permission.pb";
import type { Msg } from "@woofx3/messagebus/src/types";
import chalk from "chalk";
import type { Commands } from "./commands";
import type BarkloaderClientService from "./services/barkloader";
import type MessageBusService from "./services/messageBus";
import type TwitchChatClientService from "./services/twitchChat";
import Spotify from "./spotify";
import { parseTime } from "./util";

export type WoofWoofWoofServices = {
  barkloader: BarkloaderClientService;
  messageBus: MessageBusService;
  twitchChat: TwitchChatClientService;
};

// Context arguments type - without services (services added dynamically)
export type WoofWoofWoofContextArgs = {
  channelName: string;
  commander: Commands;
  services: ServicesRegistry;
};

// Full context type - with typed services
export type WoofWoofWoofContext = {
  channelName: string;
  commander: Commands;
  services: WoofWoofWoofServices;
};

export type WoofWoofWoofApplication = Application<WoofWoofWoofContext>;

export default class WoofWoofWoof implements ApplicationClass<WoofWoofWoofContextArgs, WoofWoofWoofContext> {
  readonly context: WoofWoofWoofContextArgs;
  // Type marker for final context - used only for type inference, never accessed at runtime
  readonly __finalContextType!: WoofWoofWoofContext;

  constructor(ctx: Omit<WoofWoofWoofContextArgs, "services">) {
    this.context = {
      ...ctx,
      services: {}, // Initialize with empty services registry
    };
  }

  async init(ctx: WoofWoofWoofContext) {
    // register message handler for barkloader
    ctx.services.barkloader.client.registerHandler("onMessage", (message: BarkloaderMessageResponse) => {
      console.log("recived on socket", message);
      try {
        if (message.error) {
          console.error(message);
          return;
        }
        if (message.command) {
          ctx.commander.send(message.args.message, {}, false);
        }
      } catch {
        console.log("failed to parse websocket message as json");
      }
    });

    // subscribe to chat message events
    ctx.services.messageBus.client.subscribe(EventType.ChatMessage, async (msg: Msg) => {
      const payload = msg.json<ChatMessageMessage>();
      const [message, matched] = await ctx.commander.process(payload.data.message, payload.data.chatterName);
      if (matched && message) {
        await ctx.commander.send(message);
      }
    });
  }

  async run(ctx: WoofWoofWoofContext) {
    console.log(chalk.yellow("#######################################################"));
    console.log(chalk.yellow.bold(`Connected to Twitch chat for channel: ${ctx.channelName}`));
    console.log(chalk.yellow("####################################################### \n"));

    const commands = await ListCommands(
      {
        applicationId: process.env.APPLICATION_ID || "",
        includeDisabled: false,
      },
      {
        baseURL: process.env.DATABASE_PROXY_URL || "",
      }
    );

    if (commands.status.code !== "OK") {
      console.error("Failed to load commands", commands.status.message);
      process.exit();
    }

    // TODO: Handle hot reloading of commands

    for (let i = 0; i < commands.commands.length; ++i) {
      this.addCommand(ctx, commands.commands[i]);
    }

    // log every message
    ctx.commander.every(async (msg: string, user?: string) => {
      console.log(`${user} says: ${msg}`);
    });

    ctx.commander.add("grantcommands", async (text: string, user?: string) => {
      await AddUserToResource(
        {
          applicationId: process.env.APPLICATION_ID || "",
          username: text,
          resource: "command/*",
          role: "moderator",
        },
        {
          baseURL: process.env.DATABASE_PROXY_URL || "",
        }
      );
      return "";
    });

    ctx.commander.add("revokecommands", async (text: string, user?: string) => {
      await RemoveUserFromResource(
        {
          applicationId: process.env.APPLICATION_ID || "",
          username: text,
          resource: "command/*",
          role: "moderator",
        },
        {
          baseURL: process.env.DATABASE_PROXY_URL || "",
        }
      );
      return "";
    });

    ctx.commander.add("vanish", async (text: string, user?: string) => {
      ctx.services.messageBus.client.publish(
        "twitchapi",
        JSON.stringify({
          command: "timeout",
          args: {
            user: user,
            duration: Math.floor(Math.random() * 600),
          },
        })
      );
      return `/me *poof* @${user} is gone`;
    });

    ctx.commander.add("follow", async (text: string) => {
      // sent request for shoutout with username
      const username = text.replace("@", "").trim();

      console.log(username);

      ctx.services.messageBus.client.publish(
        "slobs",
        JSON.stringify({
          command: "follow",
          args: { username },
        })
      );

      return "";
    });

    ctx.commander.add("song", async (text: string) => {
      // setup spotify client
      const spotify = new Spotify(
        process.env.SPOTIFY_CLIENT_ID || "",
        process.env.SPOTIFY_CLIENT_SECRET || "",
        process.env.SPOTIFY_ACCESS_TOKEN || "",
        process.env.SPOTIFY_REFRESH_TOKEN || ""
      );

      await spotify.refresh();

      const track = await spotify.currentTrack();

      return `Currently Playing: ${track.name} by ${track.artist}`;
    });

    // SONG REQUESTS
    ctx.commander.add("sr", async (text: string) => {
      console.log(text);

      // setup spotify client
      const spotify = new Spotify(
        process.env.SPOTIFY_CLIENT_ID || "",
        process.env.SPOTIFY_CLIENT_SECRET || "",
        process.env.SPOTIFY_ACCESS_TOKEN || "",
        process.env.SPOTIFY_REFRESH_TOKEN || ""
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

        console.log("trackId", trackId);

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
      switch (text) {
        case "sgd":
          ctx.services.messageBus.client.publish(
            "twitchapi",
            JSON.stringify({
              command: "update_stream",
              args: { category: "software and game development" },
            })
          );
          return "Updating stream category to Software and Game Development";
        case "jc":
          ctx.services.messageBus.client.publish(
            "twitchapi",
            JSON.stringify({
              command: "update_stream",
              args: { category: "just chatting" },
            })
          );
          return "Updating stream category to Just Chatting";
        case "irl":
          ctx.services.messageBus.client.publish(
            "twitchapi",
            JSON.stringify({
              command: "update_stream",
              args: { category: "irl" },
            })
          );
          return "Updating stream category to IRL";
        case "apex":
          ctx.services.messageBus.client.publish(
            "twitchapi",
            JSON.stringify({
              command: "update_stream",
              args: { category: "apex legends" },
            })
          );
          return "Updating stream category to Apex";
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
      ctx.services.messageBus.client.publish(
        "twitchapi",
        JSON.stringify({
          command: "update_stream",
          args: { title: text },
        })
      );

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

      ctx.services.messageBus.client.publish(
        "slobs",
        JSON.stringify({
          command: "scene_change",
          args: {
            sceneName,
          },
        })
      );

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

      ctx.services.messageBus.client.publish(
        "slobs",
        JSON.stringify({
          command: "source_change",
          args: {
            sourceName,
            value: visibility ? "on" : "off",
          },
        })
      );

      return `Updating source: ${sourceName}`;
    });

    // add a command for updating the timer
    ctx.commander.add("time", async (msg: string) => {
      const time = msg;

      console.log("update timer", parseTime(time));

      ctx.services.messageBus.client.publish(
        "slobs",
        JSON.stringify({
          command: "setTime",
          args: {
            timerId: "49b3fa3b-5eeb-40c3-bdc2-4d0e97192391",
            valueInSeconds: parseTime(time),
          },
        })
      );

      return "Timer updated";
    });
  }

  async terminate(_ctx: WoofWoofWoofContextArgs) {}

  // Add a new command
  private addCommand(ctx: WoofWoofWoofContext, command: Command) {
    // TODO: add "eval" type for inline evaluation like:
    //      - !setcommand hello eval {caller} says hello to {targetUser[0]}!
    // need to be able to eval the caller or any number of tagged users: !hello @userA @userB
    console.log("adding command", command.command);
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
        } catch (err: any) {
          console.error("Failed to send message to Barkloader", err.message);
        }
        return "";
      });
      return;
    }
    ctx.commander.add(command.command, command.typeValue);
  }
}
