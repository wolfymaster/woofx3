export function encode(event: any): Uint8Array {
    const payload = JSON.stringify(event);
    return new TextEncoder().encode(payload);
}

export function encodeCommand(payload: { command: string; args: Record<string, unknown> }): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(payload));
}
