import dotenv from 'dotenv';
import { jwtAuthenticator, wsconnect, type NatsConnection } from "@nats-io/transport-node";

dotenv.config();

let client: NatsConnection; 

export default async function NatsClient() {
    if(client) {
        return client;
    }
    const authenticator = jwtAuthenticator(process.env.NATS_USER_JWT!, Buffer.from(process.env.NATS_NKEY_SEED!));
    client = await wsconnect({ name: 'BarkLoader', servers: "tls://connect.ngs.global", authenticator });
    return client;
}

export async function natsMessageHandler<T>(msg: Msg, cb) {
    const { command, args } = msg.json<T>();
    cb(command, args);
}
