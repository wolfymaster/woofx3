import { Msg } from './types';
/**
 * Implementation of the Msg interface
 */
export declare class MessageImpl implements Msg {
    subject: string;
    data: Uint8Array;
    constructor(subject: string, data: Uint8Array);
    json<T = any>(): T;
    string(): string;
}
/**
 * Create a message from various data formats
 */
export declare function createMessage(subject: string, data: string | Uint8Array | number[]): Msg;
