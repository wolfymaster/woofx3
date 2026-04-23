import { describe, expect, mock, test } from "bun:test";
import { Commands, type AuthorizationResponse, type CommandMatch } from "./commands";

function makeChatClient() {
  const say = mock(async (_channel: string, _message: string) => {});
  return { say };
}

describe("Commands", () => {
  test("parses a bare command (no arguments) into action, cmd name, and empty tail", () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    const parsed = commands.parseAction("!hello");
    expect(parsed.action).toBe("!hello");
    expect(parsed.cmd).toBe("hello");
    expect(parsed.text).toBe("");
  });

  test("parses a command with trailing text after the first space", () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    const parsed = commands.parseAction("!sr never gonna give you up");
    expect(parsed.action).toBe("!sr");
    expect(parsed.cmd).toBe("sr");
    expect(parsed.text).toBe("never gonna give you up");
  });

  test("does not treat non-command chat as a slash-command", async () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    const [out, matched] = await commands.process("hello everyone", "user");
    expect(matched).toBe(false);
    expect(out).toBe("");
  });

  test("runs a registered string response when the user is allowed to use that command", async () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.add("roll", "you rolled a 20");
    const [out, matched] = await commands.process("!roll", "player");
    expect(matched).toBe(true);
    expect(out).toBe("you rolled a 20");
  });

  test("invokes a registered handler and returns its async result", async () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.add("echo", async (text: string) => `heard: ${text}`);
    const [out, matched] = await commands.process("!echo ping", "player");
    expect(matched).toBe(true);
    expect(out).toBe("heard: ping");
  });

  test("blocks execution when authorization denies the command and surfaces the denial message", async () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.setAuth(async (): Promise<AuthorizationResponse> => ({
      granted: false,
      message: "nope",
    }));
    commands.add("secret", "classified");
    const [out, matched] = await commands.process("!secret", "guest");
    expect(matched).toBe(true);
    expect(out).toBe("nope");
  });

  test("send forwards the message to the channel chat client", async () => {
    const chat = makeChatClient();
    const commands = new Commands("mychannel", chat as never);
    await commands.send("hello chat");
    expect(chat.say).toHaveBeenCalledTimes(1);
    expect(chat.say.mock.calls[0]).toEqual(["mychannel", "hello chat", undefined]);
  });

  test("invokes the publisher with match details when a registered command matches", async () => {
    const published: CommandMatch[] = [];
    const commands = new Commands("#chan", makeChatClient() as never, {
      publisher: (match) => {
        published.push(match);
      },
    });
    commands.add("hello", "hi there");
    await commands.process("!hello world party", "alice");
    expect(published.length).toBe(1);
    expect(published[0]).toEqual({
      commandName: "hello",
      args: ["world", "party"],
      rawMessage: "!hello world party",
      chatter: "alice",
    });
  });

  test("does not invoke the publisher for non-command chat", async () => {
    const publisher = mock((_m: CommandMatch) => {});
    const commands = new Commands("#chan", makeChatClient() as never, { publisher });
    commands.add("hello", "hi");
    await commands.process("just chatting", "alice");
    expect(publisher).not.toHaveBeenCalled();
  });

  test("does not invoke the publisher when authorization denies the command", async () => {
    const publisher = mock((_m: CommandMatch) => {});
    const commands = new Commands("#chan", makeChatClient() as never, { publisher });
    commands.setAuth(async (): Promise<AuthorizationResponse> => ({ granted: false, message: "no" }));
    commands.add("secret", "classified");
    await commands.process("!secret", "guest");
    expect(publisher).not.toHaveBeenCalled();
  });

  test("publisher failure is isolated via onPublishError and does not break the handler chain", async () => {
    const caught: Array<[unknown, CommandMatch]> = [];
    const commands = new Commands("#chan", makeChatClient() as never, {
      publisher: () => {
        throw new Error("boom");
      },
      onPublishError: (err, match) => {
        caught.push([err, match]);
      },
    });
    commands.add("hello", "hi");
    const [out, matched] = await commands.process("!hello", "alice");
    expect(matched).toBe(true);
    expect(out).toBe("hi");
    expect(caught.length).toBe(1);
    expect((caught[0][0] as Error).message).toBe("boom");
    expect(caught[0][1].commandName).toBe("hello");
  });
});
