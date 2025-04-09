import Manager from "./Manager";
import Source from "./Source";
import { RequestCtx } from "./types";

export default class Scene {
    id: string;
    resourceId: string;
    name: string;
    sources: Source[];

    constructor(private _manager: Manager, args: SceneArgs) {
        const { id, resourceId, name } = args;
        this.id = id;
        this.resourceId = resourceId;
        this.name = name;
        this.sources = [];
    }

    addSource(source: Source) {
        this.sources.push(source);
    }

    async getSceneItem(sceneItemId: string) {
        return await this._manager.request(this.resourceId, 'getItem', sceneItemId);
    }

    async removeSceneItem(sceneItemId: string) {
        return await this._manager.request(this.resourceId, 'removeItem', sceneItemId);
    }

    findSource(sourceName: string) {
        return this.sources.find(s => s.name === sourceName);
    }

    [Symbol.for('nodejs.util.inspect.custom')]() {
        return { 
            id: this.id, 
            resourceId: this.resourceId, 
            name: this.name, 
            sources: this.sources, 
        }
    }
}

type SceneArgs = {
    id: string;
    resourceId: string;
    name: string;
}
