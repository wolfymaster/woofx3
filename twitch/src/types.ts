import { Logger } from 'winston';

export interface TwitchContext {
    apiUrl: string;
    clientId: string;
    clientSecret: string;
    accessToken: string;
    logger: Logger;
}
