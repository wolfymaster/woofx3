import type { RequestPlayAudio, RequestPlayMedia } from "./types";

export default class BitHandler {
    constructor() {}

    useBits(amount: number, username: string): RequestPlayAudio | undefined {
        const bitMap: Record<number, RequestPlayAudio> = {
            1: {
                audioUrl: 'https://media.memesoundeffects.com/2023/08/Anime-wow.mp3',
            },

            2: {
                audioUrl: 'https://media.memesoundeffects.com/2021/05/Taco-Bell-Bong-Sound-Effect.mp3'
            },

            3: {
                audioUrl: 'https://streamlabs.local.woofx3.tv/pleasure.mp3',
            },

            5: {
                audioUrl: 'https://streamlabs.local.woofx3.tv/woofwoofwoof_kah-remix.mp3',
            }
        }

        return bitMap[amount];
    }
}