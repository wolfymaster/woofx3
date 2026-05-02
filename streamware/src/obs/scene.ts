import type Manager from "./manager";
import type Source from "./source";

export type SceneArgs = {
  sceneIndex: number;
  sceneName: string;
  sceneUuid: string;
};

export type SourceArgs = {
  id: string;
  sceneItemId: number;
  name: string;
  inputKind: string;
};

export default class Scene {
  id: string;
  name: string;
  sources: Source[];

  constructor(_manager: Manager, args: SceneArgs) {
    this.id = args.sceneUuid;
    this.name = args.sceneName;
    this.sources = [];
  }

  addSource(source: Source): void {
    this.sources.push(source);
  }

  findSource(sourceName: string): Source | undefined {
    return this.sources.find((s) => s.name === sourceName);
  }

  [Symbol.for("nodejs.util.inspect.custom")]() {
    return {
      id: this.id,
      name: this.name,
      sources: this.sources,
    };
  }
}
