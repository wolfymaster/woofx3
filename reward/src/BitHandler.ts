import type { RequestPayload } from "./types";

export default class BitHandler {
    constructor() {}

    useBits(amount: number, username: string): RequestPayload | undefined {
        const bitMap: Record<number, RequestPayload> = {
            1: {
                command: 'source_blur',
                args: {
                    sceneName: 'Chat', 
                    sourceName: '[NS] Main Cam', 
                    value: 15
                }
            },
            2: {
                command: 'source_blur',
                args: {
                    sceneName: 'Chat', 
                    sourceName: '[NS] Main Cam', 
                    value: 0
                }
            },
            50: {
                command: 'alert_message',
                args: {
                    audioUrl: 'https://media.memesoundeffects.com/2023/08/Anime-wow.mp3',
                }
            },
            60: {
                command: 'alert_message',
                args: {
                    audioUrl: 'https://media.memesoundeffects.com/2021/05/Taco-Bell-Bong-Sound-Effect.mp3'
                }
            },

            69: {
                command: 'alert_message',
                args: {
                    audioUrl: 'https://streamlabs.local.woofx3.tv/goodkittykitty.mp3',
                }
            },

            100: {
                command: 'alert_message',
                args: {
                    audioUrl: 'https://streamlabs.local.woofx3.tv/wolfhowl.mp3'
                }
            },

            200: {
                command: 'alert_message',
                args: {
                    audioUrl: 'https://streamlabs.local.woofx3.tv/missyou.mp3'
                }
            },

            500: {
                command: 'alert_message',
                args: {
                    audioUrl: 'https://streamlabs.local.woofx3.tv/woofwoofwoof_kah-remix.mp3'
                }
            }
        }

        return bitMap[amount];
    }
}