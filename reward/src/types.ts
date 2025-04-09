export type RewardPayload = BitReward;
export const VALID_TYPES = {
    bits: 'bits'
} as const;

type RewardTypeMap = {
    [VALID_TYPES.bits]: BitReward
};

export type RewardMessage = {
    [K in keyof RewardTypeMap]: {
        type: string;
        payload: RewardTypeMap[K]
    }    
}[keyof RewardTypeMap];

export type BitReward = {
    message: string;
    bits: number;
    isAnonymous: boolean;
    userDisplayName: string;
    userId: string;
}

export interface RequestPlayAudio {
    audioUrl: string;
}


type RequestPayloadTypeMap = {
    'alert_message': RequestPlayMedia,
    'source_blur': SourceBlurArgs
}

export type RequestPayload = {
    [K in keyof RequestPayloadTypeMap]: {
        command: string;
        args: RequestPayloadTypeMap[K]
    }
}[keyof RequestPayloadTypeMap];

interface SourceBlurArgs {
    sceneName: string; 
    sourceName: string;
    value: number;
}

export interface RequestPlayMedia {
    audioUrl?: string;
    mediaUrl?: string;
    text?: string;
    duration?: number;
}