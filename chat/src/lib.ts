import fs from 'fs/promises';
import type { AccessTokenWithUserId } from "@twurple/auth";
import type { ChatClient, ChatSayMessageAttributes } from '@twurple/chat';
import chalk from 'chalk';

export function encodeScopes(scopes: string[]) {
    return scopes.map(encodeURIComponent).join('+');
}

export async function readTokenFromFile(fileName: string): Promise<AccessTokenWithUserId> {
    const contents = await fs.readFile(fileName, { encoding: 'utf-8'});
    const token: AccessTokenWithUserId = JSON.parse(contents);
    return token;
}

export function makeSender(client: ChatClient, channel: string) {
    return async (msg: string, opts?: ChatSayMessageAttributes) => {
        console.log(chalk.yellow('sending: '), msg);
        await client.say(channel, msg, opts);
    }
}

interface Command {
    action: string;
    response: CommandResponse;
};

type CommandResponse = string | ((msg: string) => Promise<string>)

export class Commands {
    commands: Command[] = [];

    add(command: string, response: CommandResponse) {
        this.commands.push({
            action: `!${command}`,
            response,
        });
    }

    async process(text: string): Promise<[string, boolean]> {
        for(let i = 0; i < this.commands.length; ++i) {
            const { action, response } = this.commands[i];

            if(text.startsWith(action)) {
                if(typeof response === 'string') {
                    return [response, true];
                }
                if(typeof response === 'function') {
                    text = text.slice(action.length);
                    const msg = await response(text.trim());
                    return [msg, true];
                }
            }
        }
        return ['', false];
    }
}