import * as ModuleEvent from './events';
import { encode } from '../utils';
import Event from '../BaseEvent';

export * from './events';

type EventTuple = [string, Uint8Array];

export default class ModuleEvents {
    constructor(private source: string) {}

    storageChanged(event: ModuleEvent.StorageChanged): EventTuple {
        return this.encodeEvent(ModuleEvent.EventType.StorageChanged, event);
    }

    /**
     * Per-module NATS subject for a storage-change event. Publishers should
     * use this so subscribers can wildcard on `module.storage.*.changed`
     * (or `module.storage.>` for everything under the namespace).
     */
    storageChangedSubject(moduleId: string): string {
        return `module.storage.${moduleId}.changed`;
    }

    private encodeEvent(type: ModuleEvent.EventType, event: unknown): EventTuple {
        return [type, encode(Event({ type, source: this.source }, event))];
    }
}
