import OBSWebSocket, { OBSRequestTypes } from 'obs-websocket-js';
import Scene, { SceneArgs } from 'obs/Scene';
import { Context } from 'obs/types';
import Source from './Source';

export default class Manager {
    scenes: Scene[] = [];
    
    constructor(private ctx: Context, private ws: OBSWebSocket) {}

    async init() {
        // get scenes
        const obsScenes = await this.ws.call('GetSceneList')

        this.scenes = obsScenes.scenes.map( s => new Scene(this, s as SceneArgs));

        for(let i=0; i < this.scenes.length; ++i) {
            const scene = this.scenes[i];

            const { sceneItems } = await this.ws.call('GetSceneItemList', { 
                sceneName: scene.name
            });

            sceneItems.forEach(item => {
                const source = new Source(this, scene, {
                    id: item.sourceUuid as string,
                    inputKind: item.inputKind as string,
                    name: item.sourceName as string,
                    sceneItemId: item.sceneItemId as string,
                });
                scene.addSource(source);
            });
        }
    }

    async switchScene(sceneName: string) {
        return await this.ws.call('SetCurrentProgramScene', { sceneName });
    }

    async getActiveScene() {
        const scene = await this.ws.call('GetCurrentProgramScene');
        return this.findScene(scene.sceneName);
    }

    findScene(sceneName: string) {
        return this.scenes.find(s => s.name === sceneName);
    }

    async request(cmd: keyof OBSRequestTypes, args: any) {
        return this.ws.call(cmd, args);
    }

    static async New(ctx: Context, wsClient: OBSWebSocket): Promise<Manager> {
        return new Manager(ctx, wsClient);
    }
}