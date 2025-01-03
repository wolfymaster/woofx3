export interface Command {
    action: string;
    response: CommandResponse;
};

export type CommandResponse = string | ((msg: string) => Promise<string>)

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
