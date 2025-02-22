import type { RequestPlayAudio } from "./types";
import { init, id, type InstantAdminDatabase, type InstantUnknownSchema } from "@instantdb/admin";


export default class StreamLabsHandler {
    db: InstantAdminDatabase<InstantUnknownSchema>;
    APP_ID = "8c28dd52-4859-4560-8d45-2408b064b248";
    
    constructor() {   
        this.db = init({ appId: this.APP_ID, adminToken:  process.env.INSTANTDB_ADMIN_TOKEN || '' });
    }

    async playAudioFile(payload: RequestPlayAudio) {
        // playing the audio file in the browser source
        const result = await this.db.transact(
            this.db.tx.messages[id()].update({
                type: 'play_audio',
                url: payload.url,
                done: false,
                createdAt: Date.now(),
            })
        );
    
        console.log('result: ', result);
    }
}