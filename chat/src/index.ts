import { ChatClient, ChatMessage } from '@twurple/chat';
// import { AppTokenAuthProvider } from '@twurple/auth';

// Replace with your Twitch application credentials
const CLIENT_ID = '6t2yb74purkys2s5int8j5boyqj1oh';
const CLIENT_SECRET = '405krobjkzvi9757nrhuz410pl2iuk';

// Create a function to connect to Twitch chat
async function connectToTwitchChat(channel: string) {
    // const authProvider = new AppTokenAuthProvider(CLIENT_ID, CLIENT_SECRET);
    const chatClient = new ChatClient({ channels: [channel] });
    chatClient.connect();
    console.log(`Connected to Twitch chat for channel: ${channel}`);

    chatClient.onMessage(async (channel: string, user: string, text: string, msg: ChatMessage) => {
        console.log(JSON.stringify({date: msg.date, user, text}));
    });
}

// Call the function to start listening
connectToTwitchChat('jessikah_grace');


/**
 * Chat obj
 * 
 *  bits
    channelId
    date
    emoteOffsets
    hypeChatAmount
    hypeChatCurrency
    hypeChatDecimalPlaces
    hypeChatIsSystemMessage
    hypeChatLevel
    hypeChatLocalizedAmount
    id
    isCheer
    isFirst
    isHighlight
    isHypeChat
    isRedemption
    isReply
    isReturningChatter
    parentMessageId
    parentMessageText
    parentMessageUserDisplayName
    parentMessageUserId
    parentMessageUserName
    rewardId
    threadMessageId
    threadMessageUserId
    userInfo
 */