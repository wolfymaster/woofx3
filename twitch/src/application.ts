import type { HelixUser } from "@twurple/api";
import type { Application, ApplicationClass, ServicesRegistry } from "@woofx3/common/runtime";
import type { Msg } from "@woofx3/nats/src/types";
import chalk from "chalk";
import type { Logger } from "winston";
import type TwitchApiClient from "./lib/twitch";
import type { CommandResponse } from "./lib/twitch";
import type MessageBusService from "./services/messageBus";
import type TwitchEventBusService from "./services/twitchEventBus";

export type TwitchApiServices = {
  messageBus: MessageBusService;
  twitchEventBus: TwitchEventBusService;
};

export type TwitchApiContextArgs = {
  services: ServicesRegistry;
};

export type TwitchApiContext = {
  broadcaster: HelixUser;
  logger: Logger;
  services: TwitchApiServices;
  twitchApi: TwitchApiClient;
};

export type TwitchApiApplication = Application<TwitchApiContext>;

export default class TwitchApi implements ApplicationClass<TwitchApiContextArgs, TwitchApiContext> {
  readonly context: TwitchApiContextArgs;
  readonly __finalContextType!: TwitchApiContext;

  constructor(ctx: Omit<TwitchApiContextArgs, "services">) {
    this.context = {
      ...ctx,
      services: {},
    };
  }

  async init(ctx: TwitchApiContext) {
    ctx.services.twitchEventBus.client.subscribe();

    // listen on the eventbus for api calls
    await ctx.services.messageBus.client.subscribe("twitchapi", (msg: Msg) => {
      ctx.logger.info('received message', { msg });
      // natsMessageHandler<TwitchApiRequestMessage>(msg, (command: string, args: Record<string, string>) =>
      //   this.twitchApiMessageHandlerWithBroadcaster(ctx, command, args)
      // );
    });
  }

  async run(ctx: TwitchApiContext) {
    console.log(chalk.redBright(`===================== STARTING TWITCH ===========================  `));
    console.log(chalk.redBright(`Broadcaster Id: ${ctx.broadcaster.id}`));
  }

  async terminate(_ctx: TwitchApiContext) {}

  private twitchApiMessageHandlerWithBroadcaster = (
    ctx: TwitchApiContext,
    command: string,
    args: Record<string, string>
  ) => {
    return this.twitchApiMessageHandler(ctx, command, args);
  };

  private async twitchApiMessageHandler(ctx: TwitchApiContext, command: string, args: Record<string, string>) {
    // command does not exist
    if (!(command in ctx.twitchApi)) {
      return false;
    }

    // invoke twitch api
    const result: CommandResponse = await (ctx.twitchApi as any)[command](args);

    // do we need to send out a new message
    if (result.command) {
      ctx.services.messageBus.client.publish(
        result.command.topic,
        JSON.stringify({
          command: result.command.command,
          args: result.command.args,
        })
      );
    }

    if (result.error) {
      // handle the error
      ctx.logger.error(result.message);
    }

    return true;
  }
}
