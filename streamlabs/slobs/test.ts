import dotenv from 'dotenv';
import path from 'path';
import SockJS from "sockjs-client";
import Manager from "./Manager";
import Queue from "queue";
import { Context } from "./types";

dotenv.config({
    path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../', '.env')],
  });

const slobsToken = process.env.SLOBS_RPC_TOKEN || '';

const PORT = process.env.SLOBS_PORT || 59650;
const host = process.env.SLOBS_HOST || '127.0.0.1';
const baseUrl = `http://${host}:${PORT}/api`;

function makeSockJSClient(sockJsURL: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new SockJS(sockJsURL);
        ws.onopen = () => {
            resolve(ws);
        }

        ws.onerror = (err) => {
            reject(err);
        }
    })
};

// make context
const ctx: Context = {
    logger: (msg) => {
        console.log(msg);
    }
  }


// await make the client, which connects and authenticates else, fails
const client = await makeSockJSClient(baseUrl).catch(err => {
    throw new Error(err);
});

const manager = await Manager.New(ctx, client, slobsToken);

await manager.init();

console.log('scenes', manager.scenes);



