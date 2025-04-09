import Queue from "queue";
import Scene from "./Scene";
import { Context, RequestCtx, RPCRequestBody, SlobsEvent, slobsRequest, SlobsResponse } from "./types";
import { init } from "@instantdb/admin";
import Source from "./Source";

export default class Manager {
    private subscriptions: any;
    private queue: Queue<slobsRequest>;
    private requestCount = 0;
    scenes: Scene[] = [];

    constructor(private ctx: Context, private ws: WebSocket) {
        this.queue = new Queue<slobsRequest>();
        this.subscriptions = {};
    }

    async authenticate(token: string) {
        await this.request('TcpServerService', 'auth', token);
    }

    async getActiveScene() {
        const scene = await this.request('ScenesService', 'activeScene');
        return this.findScene(scene.name);
    }

    async switchScene(sceneId: string) {
        return await this.request('ScenesService', 'makeSceneActive', sceneId);
    }

    findScene(sceneName: string) {
        return this.scenes.find(s => s.name === sceneName);
    }

    private onMessageHandler(ctx: Context, message: MessageEvent) {
        let response: SlobsResponse = JSON.parse(message.data);
        let request = this.queue.get(response.id);
    
        // if we have a request matching the id of the message
        if (request) {
            if (response.error) {
                request.reject(response.error);
            } else {
                request.resolve(response.result);
            }
        }
    
        const result = response.result as SlobsEvent; 
        if (!result) return;
    
        if (result._type === 'EVENT' && result.emitter === 'STREAM') {
            this.subscriptions[result.resourceId](result.data);
          }
    }


    async request<T>(resourceId: string, method: string, ...args: any): Promise<T> {
        let requestBody: RPCRequestBody = {
            jsonrpc: '2.0',
            id: this.requestCount + 1,
            method,
            params: { resource: resourceId, args }
        }

        // reset currentIdx. Only allowing 10 requests.
        this.requestCount = (this.requestCount + 1 % 10);

        // returns a promise that sends the request over the websocket
        return new Promise((resolve, reject) => {
            this.queue.insert(requestBody.id, {
                body: requestBody,
                resolve,
                reject,
            });
            this.ws.send(JSON.stringify(requestBody));
        });
    }

    subscribe(resourceId: string, method: string, cb: any) {
        this.request(resourceId, method).then(subscriptionInfo => {
            this.subscriptions[subscriptionInfo.resourceId] = cb;
        });
    }

    async init() {
        // get scenes
        const osbScenes: any[] = await this.request('ScenesService', 'getScenes');

        this.scenes = osbScenes.map(scene => {
            const newScene = new Scene(this, {
                id: scene.id,
                resourceId: scene.resourceId,
                name: scene.name
            });

           scene.nodes.forEach(node => {
                const source = new Source(this, scene, node);
                newScene.addSource(source);
            });

            return newScene;
        });        
    }

    static async New(ctx: Context, wsClient: WebSocket, authToken: string) {
        // add ws events
        wsClient.onmessage = (message: MessageEvent) => {
            manager.onMessageHandler(ctx, message);
        }
        
        const manager = new Manager(ctx, wsClient);

        // auth
        await manager.authenticate(authToken);

        wsClient.onerror = (err) => {
            ctx.logger(`ERRRRR`);
        }

        wsClient.onclose = () => {
            ctx.logger('close')
        }

        return manager;
    }

}
