import dotenv from "dotenv";
import path from "path";
import chalk from 'chalk';
import { AuthorizationResponse, Commands } from "./commands";
import Spotify from "./spotify";
import { kasaLightsOff, kasaLightsOn } from "./kasa";
import { ListCommands } from "@woofx3/db/command.pb";
import BarkloaderClient, { BarkloaderMessageResponse } from "@woofx3/barkloader";
import { AddUserToResource, HasPermission, RemoveUserFromResource } from "@woofx3/db/permission.pb";
import TwitchClient from '@woofx3/twitch';
import MessageBus from '@woofx3/messagebus';
import { EventType, ChatMessageMessage } from '@woofx3/cloudevents/Twitch';

export interface WoofWoofWoofRequestMessage {
    command: string;
    args: Record<string, string>;
}

interface Command {
    command: string;
    type: string;
    typeValue: string;
}

dotenv.config({
    path: [
        path.resolve(process.cwd(), ".env"),
        path.resolve(process.cwd(), "../", ".env"),
    ],
});

let channel = process.env.TWITCH_CHANNEL_NAME;
if (!channel) {
    throw new Error(
        "twitch channel missing. please set environment variable: TWITCH_CHANNEL_NAME.",
    );
}

const bus = await MessageBus.createMessageBus({
    backend: 'http',
    http: {
        url:'ws://localhost:9000/ws'
    }
});

// Get Twitch Client
const twitchClient = await new TwitchClient({
    applicationId: process.env.APPLICATION_ID || '',
    channel,
    databaseURL: process.env.DATABASE_PROXY_URL || '',
})

await twitchClient.init({
    clientId: process.env.TWITCH_WOLFY_CLIENT_ID || '',
    clientSecret: process.env.TWITCH_WOLFY_CLIENT_SECRET || '',
    redirectUri: process.env.TWITCH_REDIRECT_URL || 'http://localhost',
});

// create Twitch chat client
const chatClient = twitchClient.ChatClient();

// new Commands instance
const commander = new Commands(channel, chatClient);

// add permissions check to commander
commander.setAuth(async (user: string, cmd: string) => {
    return await canUse(user, cmd);
});

// connect client
chatClient.connect();

bus.subscribe(EventType.ChatMessage, async (msg: MessageBus.Msg) => {
    const payload = msg.json<ChatMessageMessage>();
    let [message, matched] = await commander.process(payload.data.message, payload.data.chatterName);
    if(matched && message) {
        await commander.send(message);
    }
});

console.log(chalk.yellow('#######################################################'));
console.log(chalk.yellow.bold(`Connected to Twitch chat for channel: ${channel}`));
console.log(chalk.yellow('####################################################### \n'));

function woofwoofwoofMessageHandler(
    command: string,
    args: Record<string, string>,
) {
    if (command === "write_message") {
        commander.send(args.message, {}, false);
    }

    if (command === "add_command") {
        const { command, type, typeValue } = args;
        addCommand({
            command,
            type,
            typeValue,
        });
    }
}

// Barkloader websocket
const barkloaderClient = new BarkloaderClient({
    wsUrl: process.env.WOOFX3_BARKLOADER_WS_URL || "",
    onMessage: (message: BarkloaderMessageResponse) => {
        console.log("recived on socket", message);
        try {
            if (message.error) {
                console.error(message);
                return;
            }
            if (message.command) {
                commander.send(message.args.message, {}, false);
            }
        } catch (err) {
            console.log("failed to parse websocket message as json");
        }
    },
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

barkloaderClient.connect();

const commands = await ListCommands({
    applicationId: process.env.APPLICATION_ID || "",
    includeDisabled: false,
}, {
    baseURL: process.env.DATABASE_PROXY_URL || "",
});

if (commands.status.code !== "OK") {
    console.error("Failed to load commands", commands.status.message);
    process.exit();
}

// TODO: Handle hot reloading of commands

for (let i = 0; i < commands.commands.length; ++i) {
    addCommand(commands.commands[i]);
}

// Add a new command
function addCommand(command: Command) {
    // TODO: add "eval" type for inline evaluation like: 
    //      - !setcommand hello eval {caller} says hello to {targetUser[0]}!
    // need to be able to eval the caller or any number of tagged users: !hello @userA @userB
    console.log("adding command", command.command);
    if (command.type === "function") {
        commander.add(command.command, async (text: string, user?: string) => {
            try {
                barkloaderClient.send(JSON.stringify({
                    type: "invoke",
                    data: {
                        func: command.command,
                        args: [text, user],
                    },
                }));
            } catch (err: any) {
                console.error("Failed to send message to Barkloader", err.message);
            } finally {
                return "";
            }     
        });
        return;
    }
    commander.add(command.command, command.typeValue);
}

// log every message
commander.every(async (msg: string, user?: string) => {
    console.log(`${user} says: ${msg}`);
});

commander.add('grantcommands', async (text: string, user?: string) => {
    await AddUserToResource({
        applicationId: process.env.APPLICATION_ID || "",
        username: text,
        resource: "command/*",
        role: "moderator",
    }, {
        baseURL: process.env.DATABASE_PROXY_URL || "",
    })
    return ""
});

commander.add('revokecommands', async (text: string, user?: string) => {
    await RemoveUserFromResource({
        applicationId: process.env.APPLICATION_ID || "",
        username: text,
        resource: "command/*",
        role: "moderator",
    }, {
        baseURL: process.env.DATABASE_PROXY_URL || "",
    })
    return ""
});

commander.add("discord", async (text: string, user?: string) => {
    // check if the user is currently following

    // if not following, encourage them to follow

    // provide discord link if following
    return "";
});

commander.add("vanish", async (text: string, user?: string) => {
    bus.publish(
        "twitchapi",
        JSON.stringify({
            command: "timeout",
            args: {
                user: user,
                duration: Math.floor(Math.random() * 600),
            },
        }),
    );
    return `/me *poof* @${user} is gone`;
});

commander.add("lurk", async (text: string, user?: string) => {
    return "";
});

commander.add("follow", async (text: string) => {
    // sent request for shoutout with username
    const username = text.replace("@", "").trim();

    console.log(username);

    bus.publish(
        "slobs",
        JSON.stringify({
            command: "follow",
            args: { username },
        }),
    );

    return "";
});

commander.add("song", async (text: string) => {
    // setup spotify client
    const spotify = new Spotify(
        process.env.SPOTIFY_CLIENT_ID || "",
        process.env.SPOTIFY_CLIENT_SECRET || "",
        process.env.SPOTIFY_ACCESS_TOKEN || "",
        process.env.SPOTIFY_REFRESH_TOKEN || "",
    );

    await spotify.refresh();

    const track = await spotify.currentTrack();

    return `Currently Playing: ${track.name} by ${track.artist}`;
});

// SONG REQUESTS
commander.add("sr", async (text: string) => {
    console.log(text);

    // setup spotify client
    const spotify = new Spotify(
        process.env.SPOTIFY_CLIENT_ID || "",
        process.env.SPOTIFY_CLIENT_SECRET || "",
        process.env.SPOTIFY_ACCESS_TOKEN || "",
        process.env.SPOTIFY_REFRESH_TOKEN || "",
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
        const regex =
            /(?:https?:\/\/)?open\.spotify\.com\/track\/([a-zA-Z0-9]+)(?:\?|$)/;

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
commander.add("category", async (text: string) => {
    switch (text) {
        case "sgd":
            bus.publish(
                "twitchapi",
                JSON.stringify({
                    command: "update_stream",
                    args: { category: "software and game development" },
                }),
            );
            return "Updating stream category to Software and Game Development";
        case "jc":
            bus.publish(
                "twitchapi",
                JSON.stringify({
                    command: "update_stream",
                    args: { category: "just chatting" },
                }),
            );
            return "Updating stream category to Just Chatting";
        case "irl":
            bus.publish(
                "twitchapi",
                JSON.stringify({
                    command: "update_stream",
                    args: { category: "irl" },
                }),
            );
            return "Updating stream category to IRL";
        case "apex":
            bus.publish(
                "twitchapi",
                JSON.stringify({
                    command: "update_stream",
                    args: { category: "apex legends" },
                }),
            );
            return "Updating stream category to Apex";
        default:
            console.error("INVALID TWITCH CATEGORY");
    }

    return "";
});

// UPDATE STREAM TITLE
commander.add("title", async (text: string, user?: string) => {
    if (!user || user.toLowerCase() !== "wolfymaster") {
        return "Sorry, @cyburdial ruined this for everyone.";
    }
    bus.publish(
        "twitchapi",
        JSON.stringify({
            command: "update_stream",
            args: { title: text },
        }),
    );

    return `Stream title updated to: ${text}`;
});

commander.add("sc", async (text: string) => {
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

    bus.publish(
        "slobs",
        JSON.stringify({
            command: "scene_change",
            args: {
                sceneName,
            },
        }),
    );

    return "Updated Scene";
});

commander.add("src", async (text: string) => {
    if (!text) {
        return "";
    }

    let visibility = false;
    const [sourceName, onoff] = text.split(" ");

    if (onoff === "on" || onoff === "1") {
        visibility = true;
    }

    bus.publish(
        "slobs",
        JSON.stringify({
            command: "source_change",
            args: {
                sourceName,
                value: visibility ? "on" : "off",
            },
        }),
    );

    return `Updating source: ${sourceName}`;
});

commander.add("office", async (text: string) => {
    if (text === "on") {
        kasaLightsOn();
    } else {
        kasaLightsOff();
    }

    return "";
});

// add a command for updating the timer
commander.add("time", async (msg: string) => {
    const time = msg;

    console.log("update timer", parseTime(time));

    bus.publish(
        "slobs",
        JSON.stringify({
            command: "setTime",
            args: {
                timerId: "49b3fa3b-5eeb-40c3-bdc2-4d0e97192391",
                valueInSeconds: parseTime(time),
            },
        }),
    );

    return "Timer updated";
});

commander.add("partymode", async (msg: string) => {
    partyMode();
    return "party mode activated";
});

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function partyMode() {
    let onoff = true;
    while (true) {
        const rnd = Math.random() * 2;
        const milliseconds = rnd * 1000;

        const combos = [
            [true, true],
            [false, true],
            [false, false],
        ];

        const randomCombo = Math.floor(Math.random() * combos.length);

        const [mobileState, maincamState] = combos[randomCombo];

        console.log("mobile", mobileState, "maincam", maincamState);

        bus.publish(
            "slobs",
            JSON.stringify({
                command: "source_change",
                args: {
                    sourceName: "maincam",
                    value: maincamState ? "on" : "off",
                },
            }),
        );

        bus.publish(
            "slobs",
            JSON.stringify({
                command: "source_change",
                args: {
                    sourceName: "mobile",
                    value: mobileState ? "on" : "off",
                },
            }),
        );

        onoff = !onoff;

        await sleep(milliseconds);
    }
}

// function that parses string into seconds with format 2m 30s
function parseTime(duration: string): number {
    // Initialize variables for storing parsed values
    let minutes = 0;
    let seconds = 0;

    // Use a RegExp to match one or more digits before 'm' or 's', optionally followed by spaces.
    const matches = duration.match(/(\d+)\s*[ms]/g);

    if (matches) {
        for (const match of matches) {
            // Get the number part and the unit from each match.
            const num = parseInt(match);
            const unit = match.includes("m") ? "m" : "s";

            // Add to the respective variable based on the unit.
            if (unit === "m") {
                minutes += num;
            } else {
                seconds += num;
            }
        }
    }

    // Convert minutes and seconds to total seconds
    return minutes * 60 + seconds;
}

async function canUse(
    user: string,
    cmd: string,
): Promise<AuthorizationResponse> {
    const hasPermission = await HasPermission({
        username: user.trim(),
        resource: `command/${cmd}`,
        action: "read",
    }, {
        baseURL: process.env.DATABASE_PROXY_URL || "",
    });

    return {
        granted: hasPermission.code === "OK",
        message: hasPermission.code === "OK" ? "" : `${user}.... YOU CAN'T DO THAT`,
    };
}

async function gracefulShutdown(signal: string): Promise<void> {
    console.log(`\n🛑 Received ${signal}, starting graceful shutdown...`);

    try {
        barkloaderClient.destroy();
        console.log("✅ Graceful shutdown completed");
        process.exit(0);
    } catch (error) {
        console.error("❌ Error during graceful shutdown:", error);
        process.exit(1);
    }
}

// graceful shutdown
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("uncaughtException", (error) => {
    console.error("💥 Uncaught Exception:", error);
    gracefulShutdown("uncaughtException");
});
process.on("unhandledRejection", (reason, promise) => {
    console.error("🚫 Unhandled Rejection at:", promise, "reason:", reason);
    gracefulShutdown("unhandledRejection");
});
