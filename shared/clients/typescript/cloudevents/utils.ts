export function encode(event: any): Uint8Array {
    const payload = JSON.stringify(event);
    return new TextEncoder().encode(payload);
}
