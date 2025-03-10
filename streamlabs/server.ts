import dotenv from 'dotenv';
import path from 'path';
import express from "express";
import { createRequestHandler } from "@remix-run/express";
import NatsClient, { natsMessageHandler } from './nats';
import { SlobsRequestMessage } from './types';
import { init, id, type InstantAdminDatabase, type InstantUnknownSchema } from "@instantdb/admin";

dotenv.config({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../', '.env')],
});

// Message Bus
const bus = await NatsClient();

// listen on the eventbus for api calls
(async () => {
  for await (const msg of bus.subscribe('slobs')) {
      natsMessageHandler<SlobsRequestMessage>(msg, slobsMessageHander);
  }
})();

const APP_ID = "8c28dd52-4859-4560-8d45-2408b064b248";
const db = init({ appId: APP_ID, adminToken:  process.env.INSTANTDB_ADMIN_TOKEN || '' });


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

  if(command === 'alert_message') {
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

  if(command === 'count') {
      const countId = args.id;

      const query = await db.query({ counts: { 
          $: {
              where: {
                  id: countId,
              }
          }
      } })

      if(!query) {
          console.error('Did not find count with id: ', countId);
          return;
      }

      console.log(countId, query.counts[0]);

      let newCount = query.counts[0].count;

      if(args.reset) {
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
}