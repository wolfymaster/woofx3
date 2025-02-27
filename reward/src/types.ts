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
    url: string;
}

export interface RequestPlayMedia {
    audioUrl: string;
    mediaUrl: string;
    text: string;
    duration: number;
}