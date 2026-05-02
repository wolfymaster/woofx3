import type { BaseEvent } from '../BaseEvent';
import type { CommandCreated, CommandDeleted, CommandUpdated } from './events';

export type CommandCreatedMessage = BaseEvent<CommandCreated>;
export type CommandUpdatedMessage = BaseEvent<CommandUpdated>;
export type CommandDeletedMessage = BaseEvent<CommandDeleted>;
