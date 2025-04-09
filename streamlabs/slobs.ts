



interface Queue {
    insert: (idx: number, item: slobsRequest) => void;
    get: (idx: number) => slobsRequest;
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

export type SubscriptionMap = Record<string, any>;

function makeSockJSClient(ctx: Context, sockJsURL: string, manager: Manager): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new SockJS(sockJsURL);

        ws.onopen = () => {
            ctx.logger('open');
            resolve(ws);
        }

        ws.onmessage = (message: MessageEvent) => {
            manager.onMessageHandler(ctx, message);
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


export async function subscribeItemAdded(ctx: RequestCtx) {
    return await ctx.request('ScenesService', 'itemAdded');
}

// https://github.com/stream-labs/desktop/blob/master/app/services/sources/sources-api.ts#L113
export async function addBrowserSourceToScene(ctx: RequestCtx, scene: Scene, args: any) {
    const type = 'browser_source';
    const name = args.name || 'unnamed_browser_source';

    return await ctx.request("ScenesService", "createAndAddSource", scene.id, name, type, args);
}


