import dotenv from 'dotenv';
import path from 'path';
import chalk from 'chalk';
import { ApiClient, HelixUser } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { EventSubChannelCheerEvent, EventSubChannelBanEvent, EventSubChannelFollowEvent, EventSubChannelRedemptionAddEvent, EventSubChannelSubscriptionEvent, EventSubChannelSubscriptionGiftEvent, EventSubChannelSubscriptionMessageEvent, EventSubChannelRaidEvent, EventSubChannelChatNotificationEvent, EventSubChannelModerationEvent } from '@twurple/eventsub-base';
import * as twitch from './lib';
import { type Context, TwitchApiRequestMessage } from './types';
import NatsClient, { natsMessageHandler } from './nats';
import TwitchBootstrap from './twitchBootstrap';
import Commands from './commands';
import * as Handlers from './handlers';
import { CreateUserEvent } from '@client/event.pb';
import TwitchApi, { CommandResponse } from './lib/twitch';

dotenv.config({
    path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../', '.env')],
});

// logger
const logger = twitch.makeLogger({
    level: 'info',
    defaultMeta: { service: 'twitch' },
});

let channel = process.env.TWITCH_CHANNEL_NAME;
if (!channel) {
    throw new Error('twitch channel missing. please set environment variable: TWITCH_CHANNEL_NAME.')
}

// bootstrap twitch auth provider
const authProvider = await TwitchBootstrap(channel, {
    databaseURL: process.env.DATABASE_PROXY_URL || "",
});

// Message Bus
const bus = await NatsClient();

// const mockSubscriptionURL = 'http://localhost:44748/eventsub/subscriptions';

const apiClient = new ApiClient({ authProvider });
const listener = new EventSubWsListener({ apiClient });

const broadcaster = await apiClient.users.getUserByName({ name: process.env.TWITCH_CHANNEL_NAME || '' });
if (!broadcaster) {
    throw new Error('unable to resolve broadcaster');
}

// Twitch Api instance
const twitchApi = new TwitchApi(apiClient, broadcaster);

console.log(chalk.redBright(`===================== STARTING TWITCH ===========================  `));
console.log(chalk.redBright(`Broadcaster Id: ${broadcaster.id}`));

let ctx: Context = {
    logger,
};


const twitchApiMessageHandlerWithBroadcaster = (command: string, args: Record<string, string>) => {
    return twitchApiMessageHandler(command, args, broadcaster)
}

// listen on the eventbus for api calls
(async () => {
    for await (const msg of bus.subscribe('twitchapi')) {
        natsMessageHandler<TwitchApiRequestMessage>(msg, twitchApiMessageHandlerWithBroadcaster);
    }
})();

try {
    const userId = broadcaster.id;

    listener.onChannelBan(userId, (event: EventSubChannelBanEvent) => {
        let { reason, isPermanent, userDisplayName, userId } = event;

        ctx.logger.info(Commands.USER_BANNED, reason, isPermanent, userDisplayName, userId);
    });

    listener.onChannelFollow(userId, userId, async (event: EventSubChannelFollowEvent) => {
        console.log(`triggered follow`);
        const { followDate, userDisplayName, userId } = event;
        try {
            await CreateUserEvent({
                event: {
                    userId,
                    displayName: userDisplayName,
                    eventType: Commands.USER_FOLLOW,
                    follow: {
                        followDate: followDate.toISOString(),
                    }
                }
            }, {
                baseURL: process.env.DATABASE_PROXY_URL || "",
            });
        } catch (err) {
            console.error(err);
        }

        // publish the follow event to workflow
        bus.publish('workflow.follow', JSON.stringify({
            type: 'follow',
            payload: {
                userDisplayName
            }
        }));
    });

    listener.onStreamOnline(userId, (event: any) => {
        console.log('event online', event);

        // Reset Daily Sub Count
        bus.publish('slobs', JSON.stringify({
            command: 'count', // TODO: Is there a better name?
            args: {
                id: 'a2e8385b-5688-4ec2-92a1-f4bf3e3d53a4',
                reset: true,
            }
        }))

        // Reset Daily Follow Count
        bus.publish('slobs', JSON.stringify({
            command: 'count', // TODO: Is there a better name?
            args: {
                id: 'ac39613d-4f48-459c-9f4e-6f3fb0df65e0',
                reset: true,
            }
        }))
    })

    listener.onChannelCheer(userId, async (evt: EventSubChannelCheerEvent) => {
        console.log(Commands.BIT_CHEER, evt.bits, evt.message);

        const { message, bits, isAnonymous, userDisplayName, userId } = evt;

        if (!isAnonymous && userId) {
            try {
                await CreateUserEvent({
                    event: {
                        userId,
                        displayName: userDisplayName || '',
                        eventType: Commands.BIT_CHEER,
                        bitCheer: {
                            amount: bits,
                        }
                    }
                }, {
                    baseURL: process.env.DATABASE_PROXY_URL || "",
                });
            } catch (err) {
                console.error(err);
            }

        } else {
            console.log('assuming this was an annonymous cheer?', message, userDisplayName, userId);
        }

        bus.publish('reward', JSON.stringify({
            type: Commands.REWARD.BITS,
            payload: {
                message,
                bits,
                isAnonymous,
                userDisplayName,
                userId,
            }
        }))

        // publish the cheer event to workflow
        bus.publish('workflow.bits', JSON.stringify({
            type: 'bits',
            payload: {
                message,
                isAnonymous,
                amount: bits,
                user: userDisplayName,
            }
        }));

        // bus.publish('slobs', JSON.stringify({
        //     command: 'updateTime',
        //     args: {
        //         timerId: '49b3fa3b-5eeb-40c3-bdc2-4d0e97192391',
        //         valueInSeconds: bits,
        //     }
        // }));
    });

    listener.onChannelHypeTrainBegin(userId, (data: any) => {
        bus.publish('slobs', JSON.stringify({
            command: Commands.HYPE_TRAIN_BEGIN,
            args: {}
        }))

        // bus.publish('slobs', JSON.stringify({
        //     command: 'updateTime',
        //     args: {
        //         timerId: '49b3fa3b-5eeb-40c3-bdc2-4d0e97192391',
        //         valueInSeconds: 600,
        //     }
        // }));
    });

    listener.onChannelSubscriptionGift(userId, async (evt: EventSubChannelSubscriptionGiftEvent) => {
        const { gifterId, gifterDisplayName, amount, tier, isAnonymous } = evt;

        const gifterName = isAnonymous ? 'Anonymoose' : gifterDisplayName;

        console.log(Commands.USER_GIFT_SUBSCRIPTION, gifterDisplayName, amount, tier, isAnonymous);

        try {
            await CreateUserEvent({
                event: {
                    userId,
                    displayName: gifterName,
                    eventType: Commands.USER_GIFT_SUBSCRIPTION,
                    // TODO: Add gift subscription event
                }
            }, {
                baseURL: process.env.DATABASE_PROXY_URL || "",
            });
        } catch (err) {
            console.error(err);
        }

        const suborsubs = amount > 1 ? 'subscriptions' : 'subscription';

        // publish the subscription gift event to workflow
        bus.publish('workflow.subscription', JSON.stringify({
            type: 'subscription',
            payload: {
                audioUrl: 'https://streamlabs.local.woofx3.tv/allinthistogether.mp3',
                mediaUrl: 'https://media.tenor.com/MojW2yr1vFoAAAPo/money-money-money.mp4',
                text: `$$ {primary}${gifterName}{primary} gifted {primary}${amount}{primary} ${suborsubs} $$`,
            }
        }));

        // bus.publish('slobs', JSON.stringify({
        //     command: 'count', // TODO: Is there a better name?
        //     args: {
        //         id: 'a2e8385b-5688-4ec2-92a1-f4bf3e3d53a4',
        //         value: amount,
        //     }
        // }))
    })

    listener.onChannelSubscription(userId, async (event: EventSubChannelSubscriptionEvent) => {
        const { userId, userDisplayName, isGift, tier } = event;

        console.log(Commands.USER_SUBSCRIBE, userDisplayName, tier, isGift);

        try {
            await CreateUserEvent({
                event: {
                    userId,
                    displayName: userDisplayName,
                    eventType: Commands.USER_SUBSCRIBE,
                    subscribe: {
                        gift: isGift,
                        tier,
                    }
                }
            }, {
                baseURL: process.env.DATABASE_PROXY_URL || "",
            });
        } catch (err) {
            console.error(err);
        }

        // bus.publish('slobs', JSON.stringify({
        //     command: 'updateTime',
        //     args: {
        //         timerId: '49b3fa3b-5eeb-40c3-bdc2-4d0e97192391',
        //         valueInSeconds: 120,
        //     }
        // }));

        if (!isGift) {
            bus.publish('slobs', JSON.stringify({
                command: 'alert_message',
                args: {
                    audioUrl: 'https://streamlabs.local.woofx3.tv/wolf-hype.mp3',
                    mediaUrl: 'https://media.tenor.com/bj2uMQRTdSEAAAPo/dog-husky.mp4',
                    text: `<3  {primary}${userDisplayName}{primary} subscribed <3`,
                }
            }));

            bus.publish('slobs', JSON.stringify({
                command: 'count', // TODO: Is there a better name?
                args: {
                    id: 'a2e8385b-5688-4ec2-92a1-f4bf3e3d53a4',
                    value: 1,
                }
            }))
        }
    });

    // I think this is resubs - when it is announced in chat
    listener.onChannelSubscriptionMessage(userId, async (event: EventSubChannelSubscriptionMessageEvent) => {
        const { userId, userDisplayName, tier } = event;

        console.log(Commands.USER_SUBSCRIBE, userDisplayName, tier);

        try {
            await CreateUserEvent({
                event: {
                    userId,
                    displayName: userDisplayName,
                    eventType: Commands.USER_SUBSCRIBE,
                    subscribe: {
                        gift: false,
                        tier,
                    }
                }
            }, {
                baseURL: process.env.DATABASE_PROXY_URL || "",
            });
        } catch (err) {
            console.error(err);
        }

        bus.publish('slobs', JSON.stringify({
            command: 'alert_message',
            args: {
                audioUrl: 'https://streamlabs.local.woofx3.tv/wolf-hype.mp3',
                mediaUrl: 'https://media.tenor.com/bj2uMQRTdSEAAAPo/dog-husky.mp4',
                text: `<3  {primary}${userDisplayName}{primary} subscribed <3`,
            }
        }));

        bus.publish('slobs', JSON.stringify({
            command: 'count', // TODO: Is there a better name?
            args: {
                id: 'a2e8385b-5688-4ec2-92a1-f4bf3e3d53a4',
                value: 1,
            }
        }));
    });

    listener.onChannelRedemptionAdd(userId, async (evt: EventSubChannelRedemptionAddEvent) => {
        const { rewardId, rewardCost, rewardPrompt, rewardTitle, userId, userDisplayName, input } = evt;

        switch (rewardId) {
            case '7e9e40e6-1ee4-43ec-be38-252bec1f89d4':
                try {
                    const response = await fetch('https://api.console.tts.monster/generate', {
                        method: 'POST',
                        headers: {
                            authorization: process.env.TTSMONSTER_API_TOKEN || ''
                        },
                        body: JSON.stringify({
                            "voice_id": "114554e2-caa8-4377-b611-626539f3d25e",
                            "message": input
                        })
                    });

                    const data = await response.json();

                    bus.publish('slobs', JSON.stringify({
                        command: 'alert_message',
                        args: {
                            audioUrl: data.url,
                            // mediaUrl: 'https://media.tenor.com/LdHGHWDh0Y8AAAPo/look-at-you-i-see-you.mp4',
                            // text: `{primary}${userDisplayName}{primary} followed <3`,
                            // duration: 6,
                        }
                    }))
                } catch (err) {
                    console.error(err);
                }

                break;

            case '42c021b1-5ed3-4ff4-9c38-d8a3ec50867f':
                console.log('generating complement for: ', userDisplayName);
                // go get a complement
                const complement = await Handlers.complement(apiClient, { user: userDisplayName });

                console.log('generated complement: ', complement);

                const response = await fetch('https://api.console.tts.monster/generate', {
                    method: 'POST',
                    headers: {
                        authorization: process.env.TTSMONSTER_API_TOKEN || ''
                    },
                    body: JSON.stringify({
                        "voice_id": "114554e2-caa8-4377-b611-626539f3d25e",
                        "message": complement
                    })
                });

                const data = await response.json();

                bus.publish('slobs', JSON.stringify({
                    command: 'alert_message',
                    args: {
                        audioUrl: data.url,
                    }
                }));
                break;

            case 'eb053955-a188-4b84-a79f-b8d80ce22caf':
                const targetUser = input.trim().replace(/[^a-zA-Z0-9\s]/g, '');
                console.log('timeout user for 5 minutes: ', targetUser);

                bus.publish('twitchapi', JSON.stringify({
                    command: 'timeout',
                    args: {
                        user: targetUser,
                        duration: 300,
                    }
                }));
                break;
            // "Face Cam" Redeem - change to Chat scene
            case '2d231ccc-79ba-4853-bd07-1b1cb7a24da2':
                bus.publish('slobs', JSON.stringify({
                    command: 'scene_change',
                    args: {
                        sceneName: 'Chat',
                    }
                }));
                break;
            // "Code Cam" Redeem - swap to programming scene
            case 'c86fb5e5-c4f2-481d-b332-d8c6764df083':
                bus.publish('slobs', JSON.stringify({
                    command: 'scene_change',
                    args: {
                        sceneName: 'Programming',
                    }
                }));
                break;
            // "Main Cam" Redeem - turn on main cam
            case 'e0b303e0-a28c-42aa-9c02-cd356e86a87e':
                bus.publish('slobs', JSON.stringify({
                    command: 'source_change',
                    args: {
                        sourceName: 'maincam',
                        value: 'on',
                    }
                }));
                break;
                // swap to moo cam
            // "Moo Cam" Redeem - change to Moo Cam scene
            case 'b670ddcb-6024-4941-ad5c-fab4105f6ad3':             
                bus.publish('slobs', JSON.stringify({
                    command: 'scene_change',
                    args: {
                        sceneName: 'Moo Cam',
                    }
                }));
                break;
            default:
                console.log('nothing to do for rewardId: ', rewardId)
        }

        console.log(rewardId, rewardCost, rewardPrompt, rewardTitle, userId, userDisplayName, input)
    });

    // need to use moderate to get moderator actions which includes raid
    listener.onChannelModerate(userId, userId, (evt: EventSubChannelModerationEvent) => {
        const { moderationAction, moderatorDisplayName } = evt;

        ctx.logger.info(`moderation action: ${moderationAction} by ${moderatorDisplayName}`);

        switch(moderationAction) {
            case 'raid':
                bus.publish('woofwoofwoof', JSON.stringify({
                    command: 'write_message',
                    args: {
                        message: '!raid'
                    }
                }));
            break;
        }        
    })

    // when receiving a raid to my channel
    listener.onChannelRaidTo(userId, async (evt: EventSubChannelRaidEvent) => {
        const { viewers, raidingBroadcasterName, raidingBroadcasterId } = evt;
        ctx.logger.info(`incoming raid from ${raidingBroadcasterName} with ${viewers} viewers`);
    });

    // when raiding out to another channel is complete
    listener.onChannelRaidFrom(userId, async (evt: EventSubChannelRaidEvent) => {
        const { raidedBroadcasterName, viewers } = evt;

        ctx.logger.info(`raiding out to ${raidedBroadcasterName} with ${viewers} viewers`);
    });

    // special chat notifications like announcements, raid, unraid, ect
    listener.onChannelChatNotification(broadcaster, broadcaster, (evt: EventSubChannelChatNotificationEvent) => {
        let { messageText, type, sourceBroadcasterId } = evt;
        ctx.logger.info('received chat notification', { messageText, type, sourceBroadcasterId });
    });

    // on socket connection
    listener.onUserSocketConnect(() => {
        console.log(chalk.cyan("~~~~~~~~~~~~~~~~~~~~~"));
        console.log(chalk.cyan("User socket connected"));
        console.log(chalk.cyan("~~~~~~~~~~~~~~~~~~~~~"));
    });

    // on socket disconnect
    listener.onUserSocketDisconnect(() => {
        console.log(chalk.cyan("~~~~~~~~~~~~~~~~~~~~~"));
        console.log(chalk.cyan("User socket disconnected"));
        console.log(chalk.cyan("~~~~~~~~~~~~~~~~~~~~~"));
    });

    listener.start();
    ctx.logger.info('listener started');

} catch (err: any) {
    ctx.logger.error('error:', err.message);
    process.exit(0);
}

async function twitchApiMessageHandler(command: string, args: Record<string, string>) {
    // command does not exist
    if(!(command in twitchApi)) {
        return false;
    }

    // invoke twitch api
    const result: CommandResponse = await (twitchApi as any)[command](args);

    // do we need to send out a new message
    if(result.command) {
        bus.publish(result.command.topic, JSON.stringify({
            command: result.command.command,
            args: result.command.args,
        }));
    }

    if(result.error) {
        // handle the error
        logger.error(result.message);
    }

    return true;
}

// async function twitchApiMessageHandler(command: string, args: Record<string, string>, broadcaster: HelixUser) {
//     ctx.logger.info('twitchapi', { command, args });

//     const handlers: Record<string, () => Promise<any>> = {
//         chatters: () => Handlers.getChatters(apiClient),
//         update_stream: () => Handlers.updateStream(apiClient, args),
//         moderate: () => Handlers.moderate(ctx, apiClient, args, chatMessagesQueue),
//         chatMessage: () => Handlers.chatMessage(chatMessagesQueue, args),
//         timeout: () => Handlers.timeoutUser(apiClient, args, broadcaster),
//         shoutout: () => Handlers.shoutoutUser(apiClient, args, broadcaster),
//         userinfo: () => Handlers.userInfo(apiClient, args, broadcaster),
//         clip: () => Handlers.clip(apiClient, args, broadcaster),
//     }

//     const handler = handlers[command];

//     if (!handler) {
//         ctx.logger.error(`${command} is not a valid command`);
//         return;
//     }

//     const result = await handler();

//     if (result.error) {
//         ctx.logger.error(result.errorMsg);
//         return;
//     }

//     // if a command was returned, we want to reprocess
//     if (result.command) {
//         if(result.command === 'woofwoofwoof') {
//             bus.publish('woofwoofwoof', JSON.stringify({
//                command: 'write_message',
//                args: {
//                 message: result.message
//                } 
//             }));
//         }
//         await twitchApiMessageHandler(result.command, result.args, broadcaster);
//     }
// }
