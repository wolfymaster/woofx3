import type { RequestPlayAudio, RequestPlayMedia } from "./types";

export default class BitHandler {
    constructor() {}

    useBits(amount: number, username: string): RequestPlayMedia | undefined {
        const bitMap: Record<number, RequestPlayMedia> = {
            50: {
                audioUrl: 'https://media.memesoundeffects.com/2023/08/Anime-wow.mp3',
            },

            60: {
                audioUrl: 'https://media.memesoundeffects.com/2021/05/Taco-Bell-Bong-Sound-Effect.mp3'
            },

            69: {
                audioUrl: 'https://streamlabs.local.woofx3.tv/goodkittykitty.mp3',
            },

            100: {
                audioUrl: 'https://streamlabs.local.woofx3.tv/wolfhowl.mp3'
            },

            200: {
                audioUrl: 'https://streamlabs.local.woofx3.tv/missyou.mp3'
            },

            500: {
                audioUrl: 'https://streamlabs.local.woofx3.tv/woofwoofwoof_kah-remix.mp3'
            }
        }

        return bitMap[amount];
    }
}