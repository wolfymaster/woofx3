export type RequestCtx<T extends BaseSlobsResult = any> = {
    currentIdx: number;
    request: (resourceId: string, method: string, ...args: any) => Promise<T>;
    subscribe: (resourceId: string, method: string, cb: any) => void;
}

export interface SlobsResponse<T extends BaseSlobsResult = BaseSlobsResult> {
    id: number;
    result: T;
    error: string;
}

export interface SlobsEvent extends BaseSlobsResult {
    data: unknown
}

interface BaseSlobsResult {
    emitter: string;
    _type: string;
    resourceId: string;
    id: string;
    name: string; 
}

export interface slobsRequest {
    body: RPCRequestBody;
    resolve: (result: any) => void;
    reject: (error: string) => void;
}

export interface RPCRequestBody {
    jsonrpc: string;
    id: number;
    method: string;
    params: {
        resource: string,
        args: any,
    }
}


export interface Context {
    logger: (msg: string) => void
}