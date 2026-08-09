import { animate } from "./helper";
import type Manager from "./manager";
import type Scene from "./scene";
import type { SourceArgs } from "./scene";
import type { SetAnimatedFilterOptions } from "./types";

export default class Source {
  id: string;
  sceneItemId: number;
  name: string;
  type: string;

  constructor(
    private manager: Manager,
    private scene: Scene,
    args: SourceArgs,
  ) {
    this.id = args.id;
    this.sceneItemId = args.sceneItemId;
    this.name = args.name;
    this.type = args.inputKind;
  }

  async showSource() {
    return this.manager.request("SetSceneItemEnabled", {
      sceneName: this.scene.name,
      sceneItemId: this.sceneItemId,
      sceneItemEnabled: true,
    });
  }

  async hideSource() {
    return this.manager.request("SetSceneItemEnabled", {
      sceneName: this.scene.name,
      sceneItemId: this.sceneItemId,
      sceneItemEnabled: false,
    });
  }

  async setFilterValue(filterName: string, filterSetting: string, value: unknown) {
    try {
      const filterInfo = await this.manager.request("GetSourceFilter", {
        sourceName: this.name,
        filterName,
      });
      const settings = { ...(filterInfo.filterSettings as Record<string, unknown>), [filterSetting]: value };
      await this.manager.request("SetSourceFilterSettings", {
        sourceName: this.name,
        filterName,
        filterSettings: settings as Record<string, never>,
      });
    } catch (error) {
      console.error("Error setting filter value:", error);
    }
  }

  async setAnimatedFilterValue(
    filterName: string,
    filterSetting: string,
    targetValue: number,
    options?: SetAnimatedFilterOptions,
  ) {
    try {
      const { filterSettings } = await this.manager.request("GetSourceFilter", {
        sourceName: this.name,
        filterName,
      });

      const settings = filterSettings as Record<string, unknown>;
      const currentValue = parseFloat(String(settings[filterSetting] ?? 0));

      const updateFunction = async (value: number) => {
        await this.manager.request("SetSourceFilterSettings", {
          sourceName: this.name,
          filterName,
          filterSettings: { [filterSetting]: value } as Record<string, never>,
        });
      };

      await animate(updateFunction, currentValue, targetValue, options);
    } catch (error) {
      console.error("Error animating OBS filter:", error);
    }
  }

  [Symbol.for("nodejs.util.inspect.custom")]() {
    return {
      id: this.id,
      sceneItemId: this.sceneItemId,
      name: this.name,
      type: this.type,
    };
  }
}
