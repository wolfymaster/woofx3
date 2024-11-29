import { resolve } from "bun";
import SockJS from "sockjs-client";

export interface Context {
    logger: (msg: string) => {}
}

export interface RPCRequestBody {
    jsonrpc: string;
    id: number;
    method: string;
    params: {
        resource: string,
        args: any,
    }
}

export function makeSockJSClient(ctx: Context, sockJsURL: string) {
    return new Promise((resolve, reject) => {
        const ws = new SockJS(sockJsURL);

        ws.onopen = () => {
            // authorize with slobs

            resolve(ws);
        }
    
        ws.onmessage = (message: MessageEvent) => {
            ctx.logger(`message received`);
            onMessageHandler(ctx, message);
        }
    
        ws.onerror = () => {}
    
        ws.onclose = () => {}
    });
}

export function request(resourceId: string, method: string, ...args: any) {
    let requestBody: RPCRequestBody = {
        jsonrpc: '2.0',
        id: id++,
        method,
        params: { resource: resourceId, args }
    }
}

function onMessageHandler(ctx: Context, message: MessageEvent) {

}

