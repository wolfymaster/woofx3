import { OBSRequestTypes } from 'obs-websocket-js';
import Manager from './Manager';
import Scene from './Scene';
import { animate } from './helper';
import { SetAnimatedFilterOptions } from './types';

export default class Source {
    id: string;
    sceneItemId: string;
    name: string;
    type: string;

    constructor(private manager: Manager, private scene: Scene, args: SourceArgs) {
        const { id, sceneItemId, name, inputKind } = args;
        this.id = id;
        this.sceneItemId = sceneItemId;
        this.name = name;
        this.type = inputKind;
    }

    async showSource() {
        return this.manager.request('SetSceneItemEnabled', {
            sceneName: this.scene.name,
            sceneItemId: this.sceneItemId,
            sceneItemEnabled: true,
        });
    }

    async hideSource() {
        return this.manager.request('SetSceneItemEnabled', {
            sceneName: this.scene.name,
            sceneItemId: this.sceneItemId,
            sceneItemEnabled: false,
        });
    }

    async setFilterValue(filterName: string, filterSetting: string, value: any) {
        try {
            const filterInfo = await this.manager.request('GetSourceFilter', {
                sourceName: this.name,
                filterName: filterName
            });

            // Make a copy of the current settings
            const settings = { ...filterInfo.filterSettings };

            // Update the specific setting you want to change
            settings[filterSetting] = value;

            // Apply the updated settings back to the filter
            await this.manager.request('SetSourceFilterSettings', {
                sourceName: this.name,
                filterName: filterName,
                filterSettings: settings
            });
        } catch (error) {
            console.error('Error setting filter value:', error);
        }
    }

    async setAnimatedFilterValue(
        filterName: string,
        filterSetting: string,
        targetValue: number,
        options?: SetAnimatedFilterOptions
    ) {
        try {
            // Get current value
            const { filterSettings } = await this.manager.request('GetSourceFilter', {
                sourceName: this.name,
                filterName
            });

            const currentValue = parseFloat(filterSettings[filterSetting] || 0);

            // Create update function
            const updateFunction = async (value: number) => {
                await this.manager.request('SetSourceFilterSettings', {
                    sourceName: this.name,
                    filterName,
                    filterSettings: {
                        [filterSetting]: value
                    }
                });
            }

            // Run animation
            await animate(updateFunction, currentValue, targetValue, options);
        } catch (error) {
            console.error('Error animating OBS filter:', error);
        }
    }

    [Symbol.for('nodejs.util.inspect.custom')]() {
        return {
            id: this.id,
            sceneItemId: this.sceneItemId,
            name: this.name,
            type: this.type,
        }
    }
}

type SourceArgs = {
    id: string;
    sceneItemId: string;
    name: string;
    inputKind: string;
}