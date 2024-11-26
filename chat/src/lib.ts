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
    response: string;
};

export class Commands {
    commands: Command[] = [];

    add(command: string, response: string) {
        this.commands.push({
            action: `!${command}`,
            response,
        });
    }

    process(text: string): [string, boolean] {
        for(let i = 0; i < this.commands.length; ++i) {
            if(this.commands[i].action === text) {
                return [this.commands[i].response, true];
            }
        }
        return ['', false];
    }
}