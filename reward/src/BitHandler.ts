import type { RequestPlayAudio } from "./types";

export default class BitHandler {
    constructor() {}

    useBits(amount: number): RequestPlayAudio | undefined {
        // figure out what todo based on the amount of bits
        // right now, will just be to return a "play song" payload

        let url = '';

        console.log('bit amount: ', amount);

        switch(amount) {
            case 1:
                url = 'https://cdn.soundalerts.com/sounds/efdd14d7-88a8-495c-8385-4673991f3d6a.mp3';
                break;                
            case 5:
                url = 'https://media.memesoundeffects.com/2021/05/Taco-Bell-Bong-Sound-Effect.mp3';
                break;
            default:
                console.log(`no rewards for ${amount} bits`);
                break;
        }

        return {
            url
        }
    }
}