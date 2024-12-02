import SockJS from "sockjs-client";

export interface Context {
    logger: (msg: string) => void
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

interface Queue {
    insert: (idx: number, item: slobsRequest) => void;
    get: (idx: number) => slobsRequest;
}

export interface slobsRequest {
    body: RPCRequestBody;
    resolve: (result: any) => void;
    reject: (error: string) => void;
}

type RequestCtx<T extends BaseSlobsResult = any> = {
    currentIdx: number;
    request: (resourceId: string, method: string, ...args: any) => Promise<T>
}

interface SlobsResponse<T extends BaseSlobsResult = BaseSlobsResult> {
    id: number;
    result: T;
    error: string;
}

interface BaseSlobsResult {
    _type: string;
    resourceId: string;
    id: string;
    name: string;
}

interface SceneResult extends BaseSlobsResult {
    nodes: Source[]
}

export type Source = {
    id: string;
    sceneId: string;
    sourceId: string;
    sceneItemId: string;
    name: string;
    resourceId: string;
}

export type Scene = {
    id: string;
    resourceId: string;
    name: string;
    nodes: Source[];
}

export function makeSockJSClient(ctx: Context, sockJsURL: string, queue: Queue): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new SockJS(sockJsURL);

        ws.onopen = () => {
            ctx.logger('open');
            resolve(ws);
        }

        ws.onmessage = (message: MessageEvent) => {
            ctx.logger(`message received`);
            onMessageHandler(ctx, message, queue);
        }

        ws.onerror = (err) => {
            ctx.logger(`ERRRRR`);
            reject(err)
        }

        ws.onclose = () => {
            ctx.logger('close')
        }
    })
}

export function makeRequestCtx(ws: WebSocket, queue: Queue): RequestCtx {
    return {
        currentIdx: 0,
        request: function (resourceId: string, method: string, ...args: any) {
            // make request body
            let requestBody: RPCRequestBody = {
                jsonrpc: '2.0',
                id: this.currentIdx + 1,
                method,
                params: { resource: resourceId, args }
            }

            // reset currentIdx. Only allowing 10 requests.
            this.currentIdx = (this.currentIdx + 1 % 10);

            // returns a promise that sends the request over the websocket
            return new Promise((resolve, reject) => {
                queue.insert(requestBody.id, {
                    body: requestBody,
                    resolve,
                    reject,
                });
                ws.send(JSON.stringify(requestBody));
            });
        }
    }
}

export async function authenticate(ctx: RequestCtx, token: string) {
    await ctx.request('TcpServerService', 'auth', token);
    console.log('authed');
}

export async function getActiveScene(ctx: RequestCtx) {
    return await ctx.request('ScenesService', 'activeScene');
}

export async function getScenes(ctx: RequestCtx): Promise<Scene[]> {
    return await ctx.request('ScenesService', 'getScenes');
}

// https://github.com/stream-labs/desktop/blob/master/app/services/sources/sources-api.ts#L113
export async function addBrowserSourceToScene(ctx: RequestCtx, scene: Scene, args: any) {
    const type = 'browser_source';
    const name = args.name || 'unnamed_browser_source';

    return await ctx.request("ScenesService", "createAndAddSource", scene.id, name, type, args);
}

function onMessageHandler(ctx: Context, message: MessageEvent, queue: Queue) {
    let response: SlobsResponse = JSON.parse(message.data);
    let request = queue.get(response.id);

    // if we have a request matching the id of the message
    if (request) {
        if (response.error) {
            request.reject(response.error);
        } else {
            request.resolve(response.result);
        }
    }
}

