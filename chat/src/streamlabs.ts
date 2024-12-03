import { 
    addBrowserSourceToScene, authenticate, getScenes, makeRequestCtx, 
    makeSockJSClient, removeSceneItem, type Context, type Scene, type slobsRequest 
} from '../lib/slobs';
import Queue from '../lib/queue';
import chalk from 'chalk';
import NatsClient from '../lib/nats';
import type { Msg } from '@nats-io/transport-node';

interface RPCRequestBody {
    jsonrpc: string;
    id: number;
    method: string;
    params: {
        resource: string,
        args: any,
    }
}

interface slobsMessage {
    command: string;
    args: Record<string, string>
}

const PORT = 59650;
const baseUrl = `http://172.29.160.1:${PORT}/api`;
const token = '5e4e042c9834db74e4223861b1728424cb4de';
const clientId = process.env.TWITCH_CLIENT_ID;
const accessToken = process.env.TWITCH_ACCESS_TOKEN;
const twitchAPIUrl = 'https://api.twitch.tv/helix/';

const bus = await NatsClient();

// setup a subscription that runs indefinately
(async () => {
    for await (const msg of bus.subscribe('slobs')) {
        natsMessageHandler(msg);
    }
})();

function natsMessageHandler(msg: Msg) {
    const { command, args } = msg.json<slobsMessage>();

    switch (command) {
        case 'shoutout':
            createAndShowSource(args.username);
            break;
        default:
            console.error('did not match command');
    }
}

async function createAndShowSource(username: string) {
    // get broadcaster id
    const broadcasterId = await getBroadcasterId(username);

    // get clips
    const clips = await getClips(broadcasterId);

    // pick a random clip
    const randIdx = Math.floor(Math.random() * clips.length);
    const randomClip = clips[randIdx];
    const duration = randomClip.duration;

    const programmingScene = scenes.find(s => s.name === "Programming")!;

    // add browser source to scene
    const sceneItemId = await addBrowserSourceToScene(requestCtx, programmingScene, {
        name: 'shoutout',
        url: `${randomClip.embed_url}&parent=wolfymaster.com&autoplay=true`,
        width: 1920,
        height: 1080,
    });

    setTimeout(async () => {
        await removeSceneItem(requestCtx, programmingScene, sceneItemId);
    }, duration * 1000);
}

function displaySceneDetails(scenes: Scene[], sceneName: string): void {
    const scene = scenes.find(s => s.name === sceneName);

    if (!scene) {
        return;
    }

    console.log("scene: ", chalk.yellow(scene.name));
    console.log("scene id: ", chalk.red(scene.id));

    const sources = scene.nodes.map(node => ({
        id: node.id,
        name: node.name,
    }))

    console.table(sources);
}

// make context
const ctx: Context = {
    logger: (msg) => {
        console.log(msg);
    }
}

// make a queue
const slobsQueue = new Queue<slobsRequest>();
const subscriptions = {};

// await make the client, which connects and authenticates else, fails
const client = await makeSockJSClient(ctx, baseUrl, slobsQueue, subscriptions);

// create request ctx
const requestCtx = makeRequestCtx(client, slobsQueue, subscriptions);

// auth
await authenticate(requestCtx, token);

// get all scenes
const scenes = await getScenes(requestCtx);

displaySceneDetails(scenes, "Programming");

requestCtx.subscribe('ScenesService', 'itemAdded', (item: any) => {
    console.log('received item added: ', item)
});


process.on('SIGINT', async () => {
    console.log('\nTerminating connection...');
    client.close();
    await bus.drain();
    process.exit(0);
});


async function getBroadcasterId(username: string): Promise<string> {
    const url = `${twitchAPIUrl}users?login=${username}`;
    const response = await fetch(url, {
        headers: {
            'Client-Id': clientId,
            'Authorization': `Bearer ${accessToken}`,
        }
    });

    const data = await response.json();

    return data.data[0].id;
}

async function getClips(broadcasterId: string): Promise<any[]> {
    const url = new URL(`${twitchAPIUrl}clips`);
    url.searchParams.append('broadcaster_id', broadcasterId);
    url.searchParams.append('first', '10');  // Max limit for page size

    const response = await fetch(url.toString(), {
        headers: {
            'Client-Id': clientId,
            'Authorization': `Bearer ${accessToken}`,
        }
    });

    const data = await response.json();
    const clips = data.data;

    return clips;
}
