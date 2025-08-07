import dotenv from 'dotenv';
import path from 'path';
import express from "express";
import { createRequestHandler } from "@remix-run/express";
import SockJS from "sockjs-client";
import NatsClient, { natsMessageHandler } from './nats';
import { SlobsRequestMessage } from './types';
import { init, id, type InstantAdminDatabase, type InstantUnknownSchema } from "@instantdb/admin";
import Manager from 'obs/Manager';
import OBSWebSocket from 'obs-websocket-js';
import './wsShim';

dotenv.config({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../', '.env')],
});

const PORT = process.env.SLOBS_PORT || 59650;
const host = process.env.SLOBS_HOST || '127.0.0.1';
const baseUrl = `http://${host}:${PORT}/api`;
const slobsToken = process.env.SLOBS_RPC_TOKEN || '';

const APP_ID = "8c28dd52-4859-4560-8d45-2408b064b248";
const db = init({ appId: APP_ID, adminToken: process.env.INSTANTDB_ADMIN_TOKEN || '' });

const viteDevServer =
  process.env.NODE_ENV === "production"
    ? null
    : await import("vite").then((vite) =>
      vite.createServer({
        server: { middlewareMode: true },
      })
    );

const app = express();
const port = process.env.PORT || 3000;

// make context
const ctx: Context = {
  logger: (msg: string) => {
    console.log(msg);
  }
}

// TODO: Prolly want a timeout on the socket connection. Will hang if 
// await make the client, which connects and authenticates else, fails
// const client = await makeSockJSClient(baseUrl).catch(err => {
//   throw new Error(err);
// });
// const manager = await Manager.New(ctx, client, slobsToken);
// await manager.init();


const obs = new OBSWebSocket();
const connectionString = `ws://${process.env.OBS_HOST}:${process.env.OBS_PORT}`;
const token = process.env.OBS_RPC_TOKEN;
await obs.connect(connectionString, token);
const manager = await Manager.New(ctx, obs);
await manager.init();

const inMemoryStorageKV = {};

// Message Bus
const bus = await NatsClient();

// listen on the eventbus for api calls
(async () => {
  for await (const msg of bus.subscribe('slobs')) {
    natsMessageHandler<SlobsRequestMessage>(msg, slobsMessageHander);
  }
})();

// json bodyparser
app.use(express.json());

// Express middleware
app.use(
  viteDevServer
    ? viteDevServer.middlewares
    : express.static("build/client")
);
app.use(express.static("public"));

const build = viteDevServer
  ? () =>
    viteDevServer.ssrLoadModule(
      "virtual:remix/server-build"
    )
  : await import("./build/server/index.js");

// sls stats
app.post('/sls/stat', (req, res) => {
  console.log('SLS STATS: ', req.body)
  return res.sendStatus(200);
})

// Remix request handler
app.all(
  "*",
  createRequestHandler({
    build,
    mode: process.env.NODE_ENV,
  })
);

// Start server
app.listen(port, () => {
  console.log(`Express server listening on port ${port}`);
});


async function slobsMessageHander(command: string, args: Record<string, string>) {
  console.log('received command: ', command);

  if (command === 'alert_message') {
    await db.transact(
      db.tx.messages[id()].update({
        ...args,
        type: 'alert_message',
        done: false,
        createdAt: Date.now(),
        woofx3Key: process.env.WOOFX3_KEY,
      })
    );
  }

  if (command === 'count') {
    const countId = args.id;

    const query = await db.query({
      counts: {
        $: {
          where: {
            id: countId,
          }
        }
      }
    })

    if (!query) {
      console.error('Did not find count with id: ', countId);
      return;
    }

    console.log(countId, query.counts[0]);

    let newCount = query.counts[0].count;

    if (args.reset) {
      newCount = 0;
    } else {
      newCount += args.value;
    }


    await db.transact(
      db.tx.counts[countId].update({
        count: newCount,
      })
    )
  }

  if (command == 'scene_change') {
    const { sceneName } = args;

    const scene = manager.findScene(sceneName);

    if (!scene) {
      return;
    }

    await manager.switchScene(scene.name);
  }

  if (command == 'source_change') {
    const { sourceName, value } = args;
    console.log('changing source', sourceName, value);

    const currentScene = await manager.getActiveScene();
    const camScene = manager.findScene('[NS] Main Cam');

    if (!currentScene) {
      console.error('there is no current scene found');
      return;
    }

    const sourceMap = {
      'cams': { scene: currentScene, source: '[NS] Main Cam' },
      'maincam': { scene: camScene, source: 'main cam' },
      'insta': { scene: camScene, source: 'insta360' },
      'mobile': { scene: camScene, source: 'Restreamer RTMP' },
    }

    const sourceObj = sourceMap[sourceName];

    if (!sourceObj) {
      console.error('there is no sourceobj found');
      return;
    }

    const { scene, source } = sourceObj;

    const src = scene.findSource(source);

    if (!src) {
      console.error('there is no source found');
      return;
    }

    if (value === 'on') {
      return src.showSource();
    }

    return src.hideSource();
  }

  if (command == 'source_blur') {
    const { sceneName, sourceName, value } = args;

    const scene = manager.findScene(sceneName);

    if (!scene) {
      return;
    }

    const source = scene.findSource(sourceName);

    if (!source) {
      return;
    }

    source.setAnimatedFilterValue('Composite Blur', 'radius', +value, {
      durationMs: 2000,
    });
  }

  if (command == 'paint') {
    const { action, x, y, xlength, ylength, user, color } = args;

    // get user game settings
    const key = `game::paint::user::${user}`;
    const userSettings = inMemoryStorageKV[key];

    if(action == 'pencolor') {
      inMemoryStorageKV[key] = {
        pen: color
      }
      return;
    }

    // get user pen color, else default black
    const userPenColor = userSettings?.pen ?? 'black';

    if (action == 'draw') {
      await db.transact(
        db.tx.game[id()].update({
          row: x,
          col: y,
          xlength,
          ylength,
          color: userPenColor,
          done: false
        })
      )
    }
  }

  if (command == 'setTime') {
    const { timerId, valueInSeconds } = args; 

    let now = new Date();

    now.setTime(now.getTime() + (valueInSeconds * 1000));

    console.log('updating timer to ', timerId,  now.toISOString())
    try {
      await db.transact(
        db.tx.timers[timerId].update({
          expirationDate: now,
        })
      );
    } catch(err) {
      console.error(err);
      console.error(JSON.stringify(err.body));
    }   
  }

  if (command == 'updateTime') {
    const { timerId, valueInSeconds } = args; 

    const query = await db.query({
      timers: {
        $: {
          where: {
            id: timerId,
          }
        }
      }
    })

    if (!query) {
      console.error('Did not find count with id: ', timerId);
      return;
    }

    let newExpiration = query.timers[0].expirationDate;

    let newDate = new Date(newExpiration);

    newDate.setTime(newDate.getTime() + (valueInSeconds * 1000));

    console.log('updating timer to ', timerId,  newDate.toISOString())
    try {
      await db.transact(
        db.tx.timers[timerId].update({
          expirationDate: newDate,
        })
      );
    } catch(err) {
      console.error(err);
      console.error(JSON.stringify(err.body));
    }    
  }
}


function makeSockJSClient(sockJsURL: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new SockJS(sockJsURL);
    ws.onopen = () => {
      resolve(ws);
    }

    ws.onerror = (err) => {
      reject(err);
    }
  })
};
