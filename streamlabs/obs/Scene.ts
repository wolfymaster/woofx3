import Manager from "./Manager";
import Source from "./Source";

export default class Scene {
    id: string;
    name: string;
    sources: Source[];

    constructor(private _manager: Manager, args: SceneArgs) {
        const { sceneName, sceneUuid } = args;
        this.id = sceneUuid;
        this.name = sceneName;
        this.sources = [];
    }

    addSource(source: Source) {
        this.sources.push(source);
    }

    findSource(sourceName: string) {
        return this.sources.find(s => s.name === sourceName);
    }

    [Symbol.for('nodejs.util.inspect.custom')]() {
        return { 
            id: this.id, 
            name: this.name, 
            sources: this.sources, 
        }
    }
}

export type SceneArgs = {
    sceneIndex: number;
    sceneName: string;
    sceneUuid: string;
}
