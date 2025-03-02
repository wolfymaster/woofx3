export interface SlobsRequestMessage {
    command: string;
    args: Record<string, string>
}