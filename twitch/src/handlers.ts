import { ApiClient, HelixChatChatter, HelixPaginatedResultWithTotal, HelixUser } from "@twurple/api";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { PromptTemplate } from "@langchain/core/prompts";
import { ErrorHandlerResponse, HandlerResponse, SuccessHandlerResponse } from "./types";
import { tool } from '@langchain/core/tools';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
const { JsonOutputParser } = require("@langchain/core/output_parsers");

export async function getChatters(apiClient: ApiClient): Promise<HandlerResponse<HelixChatChatter[]>> {
    const broadcaster = await apiClient.users.getUserByName(process.env.TWITCH_CHANNEL_NAME || "");
    if (!broadcaster) {
        return { error: true, errorMsg: 'could not get broadcaster' };
    }
    try {
        const chatters = await apiClient.chat.getChatters(broadcaster);

        return success(chatters.data);
    } catch (err) {
        return error((err as Error).message)
    }
}

export async function updateStream(apiClient: ApiClient, args: { category?: string, title?: string }): Promise<HandlerResponse<void>> {
    const broadcaster = await apiClient.users.getUserByName(process.env.TWITCH_CHANNEL_NAME || "");

    if (!broadcaster) {
        return error('could not get broadcaster');
    }

    // update stream category
    if (args.category) {
        const game = await apiClient.games.getGameByName(args.category);

        if (!game) {
            return error('did not match any games');
        }

        await apiClient.channels.updateChannelInfo(broadcaster, {
            gameId: game.id,
        });
    }

    // update stream title
    if (args.title) {
        await apiClient.channels.updateChannelInfo(broadcaster, {
            title: args.title
        });
    }

    return success();
}

export async function moderate(apiClient: ApiClient, args, messageQueue) {
    console.log('invoking moderate');

    const parser = new JsonOutputParser();

    // Define the function that determines whether to continue or not
    function shouldContinue({ messages }: typeof MessagesAnnotation.State) {
        const lastMessage = messages[messages.length - 1] as AIMessage;
        // If the LLM makes a tool call, then we route to the "tools" node
        if (lastMessage.tool_calls?.length) {
            return "tools";
        }
        // Otherwise, we stop (reply to the user) using the special "__end__" node
        return "__end__";
    }

    // Define the function that calls the model
    async function callModel(state: typeof MessagesAnnotation.State) {
        const response = await model.invoke(state.messages);
        // We return a list, because this will get added to the existing list
        return { messages: [response] };
    }

    async function parseOutput(state: typeof MessagesAnnotation.State) {
        const lastMessage = state.messages[state.messages.length - 1];
        const parsed = await parser.invoke(lastMessage.content);
        return { messages: [new AIMessage(JSON.stringify(parsed))] };
    }

    const initialSystemMessage = `You are a moderator who follows directions and will be asked to perform tasks on behalf of the user.
        Your job is to identify the correct action that needs to be performed and then perform the tasks perfectly.
        If the action user moderation, then you will need to lookup the user in the list of known usernames, fuzzy match,
        and select the best username to use. Do not prompt for user confirmation, select the best user from the known list.
        output your final response in the format: { command: string, args: object }. Do not provide a summary. Only provide the json.
        Please verify that your output is valid json and contains no other invalid json text. I will give you a cookie if you perform this
        task correctly. Otherwise, your mother my be injured. FORMAT RESPONSE ONLY AS JSON! Return ONLY the JSON without any explanations.
    `;

    // tools    
    const getListOfKnownUsernames = tool(async (input) => {
        // get current chatters
        const chattersReq = await getChatters(apiClient);
        if (chattersReq.error) {
            return error(chattersReq.errorMsg)
        }

        return chattersReq.payload ? chattersReq.payload.map(c => c.userName) : [];
    }, {
        name: 'get_list_of_known_usernames',
        description: "get list of known usernames",
    });

    const userModerationTool = tool((input) => {
        const { action, username } = input;
        const lowercaseAction = action.toLowerCase();

        return JSON.stringify({
            command: lowercaseAction,
            args: {
                user: username
            }
        });
    }, {
        name: 'user_moderation',
        description: 'perform user moderation tasks',
        schema: z.object({
            username: z.string().describe("The username of the user"),
            action: z.enum(["TIMEOUT", "BAN", "SHOUTOUT"])
        })
    })

    const streamModeration = tool((input) => {
        const { action, value } = input;
        const lowercaseAction = action.toLowerCase();
        let jsonResponse;

        if (['title', 'category'].includes(lowercaseAction)) {
            jsonResponse = {
                command: 'update_stream',
                args: {
                    [lowercaseAction]: value
                }
            }
        }

        if (lowercaseAction === 'poll') {
            jsonResponse = {
                command: 'create_poll',
                args: {}
            }
        }

        return JSON.stringify(jsonResponse);
    }, {
        name: 'stream_moderation',
        description: 'perform stream moderation tasks',
        schema: z.object({
            action: z.enum(['POLL', 'TITLE', 'CATEGORY']),
            value: z.string().describe('value used by the action')
        })
    })

    const tools = [streamModeration, userModerationTool, getListOfKnownUsernames];
    const toolNode = new ToolNode(tools);

    // get last 10 chat messages
    // const chatMessages = messageQueue.slice(-10);
    const message = args.message;

    // build llm context
    // send to llm and get command response
    const model = new ChatAnthropic({
        model: "claude-3-5-sonnet-20240620",
        temperature: 0,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY
    }).bindTools(tools);

    const messages = [
        new SystemMessage(initialSystemMessage),
        new HumanMessage(message),
    ];

    // Define a new graph
    const workflow = new StateGraph(MessagesAnnotation)
        .addNode("agent", callModel)
        .addEdge("__start__", "agent")
        .addNode("tools", toolNode)
        .addNode("parser", parseOutput)
        // .addEdge("tools", "parser")
        .addEdge('tools', 'agent')
        .addConditionalEdges("agent", shouldContinue)

    // Finally, we compile it into a LangChain Runnable.
    const app = workflow.compile();

    // send command
    try {
        const aiResponse = await app.invoke({ messages });
        try {
            return JSON.parse(aiResponse.messages[aiResponse.messages.length - 1].content as string);
        } catch(err) {
            console.error(err);
            return error('unable to parse aiResponse as JSON');
        }
    } catch(err) {
        console.error(err);
        return error('could not generate command');
    }
}

export async function chatMessage(queue, args) {
    queue.push({
        user: args.user,
        message: args.message
    });

    return success();
}

export async function timeoutUser(apiClient: ApiClient, args, broadcaster: HelixUser) {
    const userResolvable = await apiClient.users.getUserByName(args.user);

    if(!userResolvable) {
        return;
    }

    await apiClient.moderation.banUser(broadcaster, {
        reason: '',
        user: userResolvable,
        duration: 10,
    });

    return success();
}

export async function shoutoutUser(apiClient: ApiClient, args, broadcaster: HelixUser) {
    const userResolvable = await apiClient.users.getUserByName(args.user);

    if(!userResolvable) {
        return;
    }

    await apiClient.chat.shoutoutUser(broadcaster, userResolvable);

    return success();
}

export async function complement(apiClient: ApiClient, args) {
    const rand = Math.floor(Math.random() * 1000);
    const initialSystemMessage = `Using the random seed ${rand}, generate a nice complement for the given user.
    Generate a different response each time. Be creative and avoid predictable patterns. You want to 
    give them the best complement they have ever heard. You want to make them smile. You want them
    to feel better after hearing your complement. Please limit your compliment to 80 words or less.`;

    const model = new ChatAnthropic({
        model: "claude-3-5-sonnet-20240620",
        temperature: 0,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY
    });

    const messages = [
        new SystemMessage(initialSystemMessage),
        new HumanMessage(args.user),
    ];

    const aiResponse = await model.invoke(messages);

    return aiResponse.content as string;
}

export async function userInfo(apiClient: ApiClient, args, broadcaster: HelixUser) {
    const user = await apiClient.users.getUserByName(args.username);
    if(!user) {
        return false;
    }
    const follows = await apiClient.channels.getChannelFollowers(broadcaster, user);

    if(follows.data.length < 1) {
        return false;
    }

    return true;
}

function getLatestChatMessages(numMessages: number) {

}

function error<T>(errorMsg: string): ErrorHandlerResponse<T> {
    return { error: true, errorMsg };
}

function success<T>(payload?: T): SuccessHandlerResponse<T> {
    if (!payload) {
        return { error: false };
    }

    return { error: false, payload };
}
