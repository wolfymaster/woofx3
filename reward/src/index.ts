import dotenv from 'dotenv';
import path from 'path';
import NatsClient, { natsMessageHandler } from './nats';
import { type RewardMessage, type BitReward, VALID_TYPES, type RequestPlayMedia } from './types';
import BitHandler from './BitHandler';
import BitSinger from './BitSinger';

dotenv.config({
    path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../', '.env')],
});

// Message Bus
const bus = await NatsClient();

// listen on the eventbus for api calls
(async () => {
    for await (const msg of bus.subscribe('reward')) {
        natsMessageHandler<RewardMessage>(msg, rewardMessageHandler);
    }
})();

// bit handler
const bitsHandler = new BitHandler();

// audio generators
const bitSinger = new BitSinger({
    templates: [
        { pattern: 'https://streamlabs.local.woofx3.tv/internet/internet_{n}.mp3', numClips: 15, padding: 3 },
        { pattern: 'https://streamlabs.local.woofx3.tv/mario/mario_{n}.mp3', numClips: 37, padding: 0 },
    ],
    random: false,
})

function rewardMessageHandler(message: RewardMessage) {
    switch(message.type) {
        case VALID_TYPES.bits:
            // pass the number of bits to the bits handler,
            const response = bitsHandler.useBits(message.payload.bits, message.payload.userDisplayName);

            // if we don't find an exact match, do something else....
            if(!response) {
                // play bitsinger
                let clip = bitSinger.play();
                bus.publish('slobs', JSON.stringify({
                    command: 'alert_message',
                    args: {
                        audioUrl: clip.audioUrl,
                     }
                }))
                return;
            }

            bus.publish('slobs', JSON.stringify(response))
            break;
        default:
            console.log('did not match reward');
            break;
    }
}