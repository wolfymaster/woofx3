import { NatsConnection  } from "nats";
import { ChatSayMessageAttributes } from "@twurple/chat";
import { ChatClient } from "@woofx3/twitch";

export interface Command {
    action: string;
    command: string;
    response: CommandResponse;
};

export type ChatWatcherFunction = (msg: string, user?: string) => Promise<void>

export type CommandResponse = string | ((msg: string, user?: string) => Promise<string>)


export type AuthorizationResponse = {
    granted: boolean;
    message?: string;
}
export type AuthorizationFunction = (user: string, command: string) => Promise<AuthorizationResponse>

export class Commands {
    commands: Command[] = [];
    watchers: ChatWatcherFunction[] = [];
    auth: AuthorizationFunction;

    constructor(private channel: string, private chatClient: ChatClient, private natsClient: NatsConnection) {
        this.auth = async (_user, _cmd) => ({ granted: true });
    }

    add(command: string, response: CommandResponse) {
        const cmd = this.commands.find(cmd => cmd.command === command);

        if(cmd) {
            cmd.response = response;
            return;
        }

        this.commands.push({
            action: `!${command}`,
            command,
            response,
        });
    }

    every(cb: ChatWatcherFunction) {
        this.watchers.push(cb);
    }

    async process(text: string, user: string): Promise<[string, boolean]> {
        const chatMsg = text.trim();

        this.natsClient.publish('twitchapi', JSON.stringify({
            command: 'chatMessage',
            args: { 
                user,
                message: chatMsg,
            }
        }));

        this.watchers.forEach(w => this.try(() => w(chatMsg, user)));

        // TODO: FIX: This outer loop is being called for every msg
        // can probably cache as a map
        for(let i = 0; i < this.commands.length; ++i) {
            const { action, response } = this.commands[i];
            if(!text.length || text[0] != '!') {
                return ['', false];
            }
            
            let msg = this.parseAction(text);

            if(msg.action === action) {
                const auth = await this.checkPermissions(user, msg.cmd);
                if(!auth.granted) {
                    return [auth.message ?? '', !!auth.message];
                }

                if(typeof response === 'string') {
                    return [response, true];
                }
                if(typeof response === 'function') {
                    const res = await response(msg.text, user.trim());
                    return [res, true];
                }
            }
        }
        return ['', false];
    }

    parseAction(text: string) {
        const spaceidx = text.indexOf(' ');
        if(spaceidx === -1) {
            return {
                action: text.trim(),
                cmd: text.slice(1).trim(),
                text: '',
            }
        } 

        return {
            action: text.slice(0, spaceidx).trim(), // full command with !
            cmd: text.slice(1, spaceidx).trim(), // command (wihout !)
            text: text.slice(spaceidx + 1).trim(), // text following command
        };
    }

    async send(msg: string, opts?: ChatSayMessageAttributes, parseCommand = true)  {
        if(parseCommand) {
            let [message, matched] = await this.process(msg, this.channel);
            if(matched && message) {
                await this.chatClient.say(this.channel, msg, opts);
            }
        } else {
            await this.chatClient.say(this.channel, msg, opts);
        }    
    }

    try(f: any) {
        try {
            f();
        } catch(err) {}
    }

    async checkPermissions(user: string, cmd: string) {
        return await this.auth(user, cmd);
    }

    setAuth(authFunc: AuthorizationFunction) {
        this.auth = authFunc;
    }
}
