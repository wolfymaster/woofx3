import { NatsConnection  } from "nats";

export interface Command {
    action: string;
    command: string;
    response: CommandResponse;
};

export type ChatWatcherFunction = (msg: string, user?: string) => Promise<void>

export type CommandResponse = string | ((msg: string, user?: string) => Promise<string>)

export class Commands {
    commands: Command[] = [];
    watchers: ChatWatcherFunction[] = [];

    constructor(private natsClient: NatsConnection) {}

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

        for(let i = 0; i < this.commands.length; ++i) {
            const { action, response } = this.commands[i];
            if(!text.length || text[0] != '!') {
                return ['', false];
            }
            
            let msg = this.parseAction(text);

            if(msg.cmd === action) {
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
                cmd: text.trim(),
                text: '',
            }
        } 

        return {
            cmd: text.slice(0, spaceidx).trim(),
            text: text.slice(spaceidx + 1).trim(),
        };
    }

    try(f: any) {
        try {
            f();
        } catch(err) {}
    }
}
