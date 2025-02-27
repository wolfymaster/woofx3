import type { RequestPlayAudio, RequestPlayMedia } from "./types";

export default class BitHandler {
    constructor() {}

    useBits(amount: number, username: string): RequestPlayAudio | RequestPlayMedia | undefined {
        // figure out what todo based on the amount of bits
        // right now, will just be to return a "play song" payload

        let url = '';

        console.log('bit amount: ', amount);

        switch(amount) {
            case 5:
                url = 'https://browsersource.local.woofx3.tv/woofwoofwoof_kah-remix.mp3';
                break;                
            case 1:
                url = 'https://media.memesoundeffects.com/2023/08/Anime-wow.mp3';
                break;
            case 2:
                url = 'https://media.memesoundeffects.com/2021/05/Taco-Bell-Bong-Sound-Effect.mp3';
                break;
            case 3:
                url = 'https://cdn.soundalerts.com/sounds/be39b37a-23cc-44fa-a92d-82881fb8b4cf.mp3';
                break;
            default:
                console.log(`no rewards for ${amount} bits`);
                break;
        }

        return {
            audioUrl: url,
            mediaUrl: 'https://media.tenor.com/LdHGHWDh0Y8AAAPo/look-at-you-i-see-you.mp4',
            text: `<3 Thanks {primary}${username}{primary} We LOVE you <3`,
            duration: 5,
        }
    }
}