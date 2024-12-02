import { addBrowserSourceToScene, authenticate, getActiveScene, getScenes, makeRequestCtx, makeSockJSClient, type Context, type Scene, type slobsRequest } from '../lib/slobs';
import Queue from '../lib/queue';
import chalk from 'chalk';
import express from 'express';

interface RPCRequestBody {
    jsonrpc: string;
    id: number;
    method: string;
    params: {
        resource: string,
        args: any,
    }
}

const PORT = 59650;
const baseUrl = `http://172.29.160.1:${PORT}/api`;
const token = '5e4e042c9834db74e4223861b1728424cb4de';
const clientId = process.env.TWITCH_CLIENT_ID;
const accessToken = process.env.TWITCH_ACCESS_TOKEN;
const twitchAPIUrl = 'https://api.twitch.tv/helix/';

// request('ScenesService', 'getScenes').then( scenes => {
//     console.log('scenes', scenes);
//     scenes.forEach(scene => {
//         console.log('scene: ', scene.id, scene.name);
//     });
// });        

// request('SourcesService', 'getSources').then (sources => {
//     sources.forEach( source => {
//         console.log('source:', source.id, source.name);
//     })
// })

// getActiveScene().then(scene => {
//     console.log('scene', scene);
//     const items = scene.nodes;

//     const browser = items.find(item => item.name === '_browser');

//     const resourceId = scene.resourceId;
//     const itemId = browser.sceneItemId;

//     console.log(resourceId, itemId);

//     request(resourceId, 'getItem', itemId).then(browserItem => {
//         request(browserItem.resourceId, 'setVisibility', 'true')
//     })


// });

// switchScene('scene_bc24a839-126e-4bf8-a295-c7657f4b9219');
// getSourcesForCurrentScene();


function switchScene(sceneId: string) {
    request('ScenesService', 'makeSceneActive', sceneId);
}


function getSourcesForCurrentScene() {
    request('ScenesService', 'getSourcesForCurrentScene').then(sources => {
        console.log(sources);
    });
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

const app = express();


// make a queue
const slobsQueue = new Queue<slobsRequest>();

// await make the client, which connects and authenticates else, fails
const client = await makeSockJSClient(ctx, baseUrl, slobsQueue);

// create request ctx
const requestCtx = makeRequestCtx(client, slobsQueue);

// auth
await authenticate(requestCtx, token);
console.log('we have authenticated');

// get active scene
// const activeScene = await getActiveScene(requestCtx);
// console.log(activeScene);

// get all scenes
const scenes = await getScenes(requestCtx);

displaySceneDetails(scenes, "Programming");

const programmingScene = scenes.find(s => s.name === "Programming")!;

// getSceneByName(ctx, "Chat") or getSceneByName("Agenda")

// hideSource(ctx, scene, "source name")

// showSource(ctx, scene "source name")

// getSceneByName will need to make many requests using await ctx.request(resourceId, method, ...args)

app.get('/:username/clip', async (req, res) => {
    const url = req.query.url; 

    res.send(`
        <iframe
        src="https://clips.twitch.tv/embed?clip=<slug>&parent=streamernews.example.com"
        height="<height>"
        width="<width>"
        allowfullscreen>
    </iframe>

    `);
})

app.get('/:username', async (req, res) => {
    console.log('username: ', req.params.username);
    try {
        // get broadcaster id
        const broadcasterId = await getBroadcasterId(req.params.username);

        // get clips
        const clips = await getClips(broadcasterId);

        // pick a random clip
        const randIdx = Math.floor(Math.random() * clips.length);
        const randomClip = clips[randIdx];

        console.log('clip: ', randomClip);

        // add browser source to scene
        await addBrowserSourceToScene(requestCtx, programmingScene, {
            name: 'shoutout',
            url: `${randomClip.embed_url}&parent=wolfymaster.com&autoplay=true`
        });
    } catch (err) {
        console.error(err);
        return res.json({ status: 'error' })
    }

    res.json({ status: 'ok' })
});


app.listen(9653, () => {
    console.log('server is listening on 9653');
})


process.on('SIGINT', () => {
    console.log('\nTerminating connection...');
    client.close();
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

    console.log('response', response)

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
