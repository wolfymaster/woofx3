import chalk from 'chalk';
import { serve } from "bun";
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { LuaFactory } from 'wasmoon';
import NatsClient, { natsMessageHandler } from './nats';
import { InvokeRequest, WebSocketMessage, TimerArgs, StreamAlertArgs, TwitchArgs } from "./types";
import { Command, SetCommand } from '@client/command.pb';

// receive message
// invokeRequest

// organize into modules... each module has methods that accept args. 

// modules receive an 'event' and return a command? 
// modules can "Subscribe" to multiple events
// modules decide how to respond to an event. 

// ex: Listens to chatMessageEvent
// internally, invokes

// keep this pure in the sense that it receives what it needs to execute the correct code, and then returns the response
// this will also be responsible for compiling / saving code to object storage and loading it at runtime

dotenv.config({
    path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../', '.env')],
});

// set port
const port = process.env.PORT || 3005;

// create NATS client
const bus = await NatsClient();

// Track connected clients
const clients = new Map();
let clientId = 0;

const broadcasterId = process.env.TWITCH_BROADCASTER_ID || '';

console.log(chalk.yellow('==================================='));
console.log(chalk.blue('STARTING BARKLOADER'))
console.log(chalk.blue(new Date()));
console.log(chalk.blue(`PORT: ${port}`));
console.log(chalk.yellow('==================================='));

const server = serve({
    port,
    fetch(req, server) {
        // Handle WebSocket upgrade requests
        if (req.headers.get("upgrade") === "websocket") {
            const upgraded = server.upgrade(req);
            if (!upgraded) {
                return new Response("WebSocket upgrade failed", { status: 400 });
            }

            // WebSocket connection established - handled by onOpen below
            return;
        }

        // Handle regular HTTP requests
        return new Response("This is a WebSocket server. Please connect with a WebSocket client.");
    },
    websocket: {
        // Called when a client connects
        open(ws) {
            const id = ++clientId;
            clients.set(id, ws);
            console.log(`Client ${id} connected`);

            // Send welcome message
            ws.send(JSON.stringify({
                type: "welcome",
                message: "Connected to WebSocket server",
                id
            }));
        },
        // Called when a client sends a message
        async message(ws, message) {
            try {
                // Try to parse as JSON
                const data = JSON.parse(message) as WebSocketMessage;
                console.log("Received message:", data);

                if (data.type === 'invoke') {
                    const { args, func } = data.data as InvokeRequest;

                    const factory = new LuaFactory();
                    const lua = await factory.createEngine();
                    
                    // generic http request host function
                    lua.global.set('httpRequest', async (url: string, method: string, opts: { body?: any, headers?: Record<string, string> } = {}) => {
                        const response = await fetch(url, {
                            method,
                            headers: opts.headers || {},
                            body: opts.body ? JSON.stringify(opts.body) : undefined
                        });
                        return response.json();
                    });

                    lua.global.set('environment', (value: string) => {
                        return process.env[value];
                    })

                    lua.global.set('stream_alert', async (args: StreamAlertArgs) => {
                        bus.publish('slobs', JSON.stringify({
                            command: 'alert_message',
                            args
                        }));
                    })

                    lua.global.set('twitch', (args: TwitchArgs) => {
                        bus.publish('twitchapi', JSON.stringify({
                            command: 'clip',
                            args
                        }));
                    });
                    

                    lua.global.set('setTimer', async (args: TimerArgs) => {
                        bus.publish('slobs', JSON.stringify({
                            command: 'setTime',
                            args: {
                                timerId: args.id,
                                valueInSeconds: parseTime(args.valueInSeconds),
                            }
                        }));
                    });

                    lua.global.set('setCommand', async (args: Command) => {
                        console.log('calling setCommand', args);

                        // verify valid type
                        if(args?.type && !['func', 'function', 'text'].includes(args.type)) {
                            return;
                        }

                        if(args?.type && args.type === 'func') {
                            args.type = 'function'
                        };
                    
                        const command = {  ...args, broadcasterId };
                        await SetCommand(command,  {
                            baseURL: process.env.DATABASE_PROXY_URL || "",
                        })

                        bus.publish('woofwoofwoof', JSON.stringify({
                            command: 'add_command',
                            args: command,
                        }))
                    });

                    // get function from storage
                    const luaLightScript = fs.readFileSync(`lua/${func}.lua`, 'utf8');

                    // run function with args, get response
                    await lua.doString(luaLightScript);

                    const main = lua.global.get('main');
                    const response = await main(...args) || '';

                    console.log('response', response);

                    // return response over websocket
                    ws.send(JSON.stringify({
                        error: false,
                        command: 'write_message', 
                        args: {
                            message: response,
                        }
                    }))
                }
            } catch (e) {
                console.log('error', e);
                // Handle non-JSON messages
                ws.send(JSON.stringify({
                    error: true,
                    message: e,
                    received: message.toString()
                }));
            }
        },
        // Called when a client disconnects
        close(ws, code, message) {
            // Find and remove the client
            for (const [id, client] of clients.entries()) {
                if (client === ws) {
                    clients.delete(id);
                    console.log(`Client ${id} disconnected`);
                    break;
                }
            }
        },
        // Error handling
        drain(ws) {
            console.log("WebSocket backpressure drained");
        }
    }
});

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

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
            const unit = match.includes('m') ? 'm' : 's';

            // Add to the respective variable based on the unit.
            if (unit === 'm') {
                minutes += num;
            } else {
                seconds += num;
            }
        }
    }

    // Convert minutes and seconds to total seconds
    return minutes * 60 + seconds;
}

function shutdown() {    
    console.log('shutting down server')
    server.stop();
    process.exit(0);
}