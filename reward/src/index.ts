import dotenv from 'dotenv';
import path from 'path';
import NatsClient, { natsMessageHandler } from './nats';
import { type RewardMessage, type BitReward, VALID_TYPES, type RequestPlayMedia } from './types';
import BitHandler from './BitHandler';
import StreamLabsHandler from './StreamLabsHandler';

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

function rewardMessageHandler(message: RewardMessage) {
    switch(message.type) {
        case VALID_TYPES.bits:
            const bitsHandler = new BitHandler();

            // pass the number of bits to the bits handler,
            const response = bitsHandler.useBits(message.payload.bits, message.payload.userDisplayName);

            if(!response) {
                return;
            }

            // it should return a payload describing what to do
            // "what to do handler" that performs the actions
            const streamLabs = new StreamLabsHandler();

            // streamLabs.playAudioFile(response);
            streamLabs.playMedia(response as RequestPlayMedia);
            break;
        default:
            console.log('did not match reward');
            break;
    }
}