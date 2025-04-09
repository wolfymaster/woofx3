import { Scene } from "slobs";
import Manager from "./Manager";

export default class Source {
    id: string;
    sourceId: string;
    sceneItemId: string;
    name: string;
    resourceId: string;
    type: string;

    constructor(private manager: Manager, private scene: Scene, args: SourceArgs) {
        const { id, sourceId, sceneItemId, name, resourceId, sceneNodeType } = args;
        this.id = id;
        this.sourceId = sourceId;
        this.sceneItemId = sceneItemId;
        this.name = name;
        this.resourceId = resourceId;
        this.type = sceneNodeType;
    }

    async showSource() {
        return await this.manager.request(this.resourceId, 'setVisibility', true);
    }

    async hideSource() {
        return await this.manager.request(this.resourceId, 'setVisibility', false);
    }

    [Symbol.for('nodejs.util.inspect.custom')]() {
        return {
            id: this.id,
            sourceId: this.sourceId,
            sceneItemId: this.sceneItemId,
            name: this.name,
            resourceId: this.resourceId,
            type: this.type,
        }
    }
}

type SourceArgs = {
    id: string;
    sceneId: string;
    sourceId: string;
    sceneItemId: string;
    name: string;
    resourceId: string;
    sceneNodeType: string;
}