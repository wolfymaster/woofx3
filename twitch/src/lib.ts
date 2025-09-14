import fs from 'fs/promises';
import { type TwitchContext } from "./types";
import { AccessTokenWithUserId } from '@twurple/auth';
import winston, { LoggerOptions } from 'winston';

export function makeLogger(opts?: LoggerOptions): winston.Logger {
    const { combine, prettyPrint } = winston.format;
    const filterCtx = winston.format( (info, opts) => {
        let ctx = info.ctx as Partial<TwitchContext>;
        if(ctx) {
            delete ctx.logger;
        }
        return info;
    });
    const logger = winston.createLogger({
        format: combine(
            winston.format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss'
            })
        ),
        transports: [
            new winston.transports.Console({ format: combine(filterCtx(), winston.format.json(), prettyPrint()) }),
        ],
        ...opts,
    });
    return logger;
}

export async function getBroadcasterId(ctx: TwitchContext, username: string): Promise<string> {
    ctx.logger.info('getBroadcastId', { username });
    const url = `${ctx.apiUrl}users?login=${username}`;
    const response = await fetch(url, {
        headers: {
            'Client-Id': ctx.clientId,
            'Authorization': `Bearer ${ctx.accessToken}`,
        }
    });

    const data = await response.json();

    if(data.error) {
        throw new Error("Received error from twitch api: " + data.message)
    }

    return data.data[0].id;
}

export async function readTokenFromFile(fileName: string): Promise<AccessTokenWithUserId> {
    const contents = await fs.readFile(fileName, { encoding: 'utf-8'});
    const token: AccessTokenWithUserId = JSON.parse(contents);
    return token;
}
