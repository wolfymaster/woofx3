// Lifecycle events emitted by the engine when chat commands are created,
// updated, or deleted via the Api. Distinct from chat.command.<slug> in
// Chat/commands.ts, which fires on invocation by a chat user.

export enum EventType {
    Created = 'command.created',
    Updated = 'command.updated',
    Deleted = 'command.deleted',
}

export interface CommandSnapshot {
    id: string;
    applicationId: string;
    command: string;
    type: string;
    typeValue: string;
    cooldown: number;
    priority: number;
    enabled: boolean;
}

export interface CommandCreated {
    command: CommandSnapshot;
}

export interface CommandUpdated {
    command: CommandSnapshot;
}

export interface CommandDeleted {
    id: string;
    applicationId: string;
    command: string;
}
