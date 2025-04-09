import dotenv from 'dotenv';
import path from 'path';
import './wsShim';
import OBSWebSocket, { EventSubscription } from 'obs-websocket-js';
import Manager from 'obs/Manager';
import { Context } from 'slobs/types';

dotenv.config({
    path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../', '.env')],
});

const ctx: Context = {
    logger: (msg: string) => {
        console.log(msg);
    }
}

const obs = new OBSWebSocket();

try {
    const connectionString = `ws://${process.env.OBS_HOST}:4456`;
    const token = process.env.OBS_RPC_TOKEN;

    await obs.connect(connectionString, token);

    const manager = await Manager.New(ctx, obs);

    await manager.init();

    const currentScene = await manager.getActiveScene();

    // const chatScene = manager.findScene('Chat');

    // if(chatScene) {
    //     await manager.switchScene(chatScene.name);
    // }

    console.log(currentScene);

    const maincam =  currentScene?.findSource('[NS] Main Cam');

    console.log('maincam', maincam);

    maincam?.setAnimatedFilterValue('Composite Blur', 'radius', 0, {
        durationMs: 5000,
    });
} catch (err) {
    console.error(err.code, err.message);
}

