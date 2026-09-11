import dotenv from "dotenv";
import path from "path";
import "./wsShim";
import OBSWebSocket, { EventSubscription } from "obs-websocket-js";
import Manager from "obs/Manager";
import { Context } from "slobs/types";
import { contextLogger, logger } from "./logger";

dotenv.config({
  path: [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "../", ".env")],
});

const ctx: Context = {
  logger: contextLogger(),
};

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

  logger.info("active scene", { scene: currentScene?.name });

  const maincam = currentScene?.findSource("[NS] Main Cam");

  logger.info("main cam source", { source: maincam?.name });

  maincam?.setAnimatedFilterValue("Composite Blur", "radius", 0, {
    durationMs: 5000,
  });
} catch (err) {
  logger.error("obstest failed", { code: err.code, message: err.message });
}
