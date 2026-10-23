/**
 * The character a chat line starts with to run a command. The outgoing-line
 * guard and the chat command dispatcher both read it from here. Must match
 * COMMAND_PREFIX in woofwoofwoof/src/sentLines.ts, the commander's prefix
 * while woofwoofwoof still runs commands.
 */
export const COMMAND_PREFIX = "!";
