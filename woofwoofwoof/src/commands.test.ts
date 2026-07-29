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
      text: "world party",
      variables: {},
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

  test("resolves {template} variables in a string response", async () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.add("greet", "hello {user}, you said: {argsText}");
    const [out, matched] = await commands.process("!greet nice to meet you", "wolfy");
    expect(matched).toBe(true);
    expect(out).toBe("hello wolfy, you said: nice to meet you");
  });

  test("drops an invocation within the cooldown window and does not re-trigger the publisher", async () => {
    const publisher = mock((_m: CommandMatch) => {});
    const commands = new Commands("#chan", makeChatClient() as never, { publisher });
    commands.add("roll", "you rolled a 20", { cooldownSeconds: 60 });

    const [first, firstMatched] = await commands.process("!roll", "player");
    expect(firstMatched).toBe(true);
    expect(first).toBe("you rolled a 20");

    const [second, secondMatched] = await commands.process("!roll", "player");
    expect(secondMatched).toBe(false);
    expect(second).toBe("");
    expect(publisher).toHaveBeenCalledTimes(1);
  });

  test("allows an invocation once the cooldown window has elapsed", async () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.add("roll", "you rolled a 20", { cooldownSeconds: 60 });
    (commands.commands[0] as { lastInvokedAt?: number }).lastInvokedAt = Date.now() - 61_000;

    const [out, matched] = await commands.process("!roll", "player");
    expect(matched).toBe(true);
    expect(out).toBe("you rolled a 20");
  });

  test("cooldown survives a hot-reloaded (updated) command", async () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.add("roll", "you rolled a 20", { cooldownSeconds: 60 });
    await commands.process("!roll", "player");

    // Simulate a command.updated hot-reload: same name, re-added.
    commands.add("roll", "you rolled a 20 (v2)", { cooldownSeconds: 60 });

    const [out, matched] = await commands.process("!roll", "player");
    expect(matched).toBe(false);
    expect(out).toBe("");
  });

  test("a cooldown of 0 never throttles", async () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.add("roll", "you rolled a 20", { cooldownSeconds: 0 });
    await commands.process("!roll", "player");
    const [out, matched] = await commands.process("!roll", "player");
    expect(matched).toBe(true);
    expect(out).toBe("you rolled a 20");
  });

  test("public visibility bypasses the auth check entirely", async () => {
    const auth = mock(async (): Promise<AuthorizationResponse> => ({ granted: false, message: "no" }));
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.setAuth(auth);
    commands.add("hello", "hi there", { visibility: "public" });

    const [out, matched] = await commands.process("!hello", "anyone");
    expect(matched).toBe(true);
    expect(out).toBe("hi there");
    expect(auth).not.toHaveBeenCalled();
  });

  test("restricted (default) visibility still calls the auth check", async () => {
    const auth = mock(async (): Promise<AuthorizationResponse> => ({ granted: true }));
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.setAuth(auth);
    commands.add("hello", "hi there");

    await commands.process("!hello", "anyone");
    expect(auth).toHaveBeenCalledTimes(1);
  });

  test("caches a permission decision so repeat invocations by the same user skip the auth check", async () => {
    const auth = mock(async (): Promise<AuthorizationResponse> => ({ granted: true }));
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.setAuth(auth);
    commands.add("hello", "hi there");

    await commands.process("!hello", "anyone");
    await commands.process("!hello", "anyone");
    await commands.process("!hello", "anyone");
    expect(auth).toHaveBeenCalledTimes(1);
  });

  test("caches per (user, command) — a different user still triggers its own auth check", async () => {
    const auth = mock(async (): Promise<AuthorizationResponse> => ({ granted: true }));
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.setAuth(auth);
    commands.add("hello", "hi there");

    await commands.process("!hello", "alice");
    await commands.process("!hello", "bob");
    expect(auth).toHaveBeenCalledTimes(2);
  });

  test("caches per (user, command) — a different command still triggers its own auth check", async () => {
    const auth = mock(async (): Promise<AuthorizationResponse> => ({ granted: true }));
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.setAuth(auth);
    commands.add("hello", "hi there");
    commands.add("bye", "cya");

    await commands.process("!hello", "anyone");
    await commands.process("!bye", "anyone");
    expect(auth).toHaveBeenCalledTimes(2);
  });

  test("caches a denial as well as a grant", async () => {
    const auth = mock(async (): Promise<AuthorizationResponse> => ({ granted: false, message: "no" }));
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.setAuth(auth);
    commands.add("secret", "classified");

    const [first] = await commands.process("!secret", "guest");
    const [second] = await commands.process("!secret", "guest");
    expect(first).toBe("no");
    expect(second).toBe("no");
    expect(auth).toHaveBeenCalledTimes(1);
  });

  test("replacing the auth function via setAuth invalidates previously cached decisions", async () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.add("hello", "hi there");

    const denyAuth = mock(async (): Promise<AuthorizationResponse> => ({ granted: false, message: "no" }));
    commands.setAuth(denyAuth);
    const [firstOut] = await commands.process("!hello", "anyone");
    expect(firstOut).toBe("no");

    const allowAuth = mock(async (): Promise<AuthorizationResponse> => ({ granted: true }));
    commands.setAuth(allowAuth);
    const [secondOut, matched] = await commands.process("!hello", "anyone");
    expect(matched).toBe(true);
    expect(secondOut).toBe("hi there");
    expect(allowAuth).toHaveBeenCalledTimes(1);
  });

  test("a single {variable} captures the entire remainder, not split on whitespace", async () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.add("sr", "queued: {songTitle}", { variables: ["songTitle"] });
    const [out, matched] = await commands.process("!sr Life is a highway", "player");
    expect(matched).toBe(true);
    expect(out).toBe("queued: Life is a highway");
  });

  test("multiple {variable}s are split positionally, last one catching the remainder", async () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.add("hug", "{userA} hugs {userB}", { variables: ["userA", "userB"] });
    const [out, matched] = await commands.process("!hug alice bob smith", "player");
    expect(matched).toBe(true);
    // userA gets exactly one token; userB (last) gets the rest rejoined.
    expect(out).toBe("alice hugs bob smith");
  });

  test("missing trailing arguments resolve to empty string, not undefined", async () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.add("hug", "[{userA}] [{userB}]", { variables: ["userA", "userB"] });
    const [out] = await commands.process("!hug alice", "player");
    expect(out).toBe("[alice] []");
  });

  test("dot-separated {variable} names build a nested object for the resolver", async () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.add("greet", "hello {target.name}", { variables: ["target.name"] });
    const [out] = await commands.process("!greet wolfy", "player");
    expect(out).toBe("hello wolfy");
  });

  test("a {variable} named the same as a reserved context key (e.g. \"user\") does not clobber it", async () => {
    // Reserved keys (user, args, argsText, rawMessage, command) always win
    // over an extracted variable of the same top-level name, so existing
    // {user}/{command} templates can't be silently broken by a chat-authored
    // command that happens to declare a variable rooted at the same name.
    const commands = new Commands("#chan", makeChatClient() as never);
    commands.add("greet", "hi {user}", { variables: ["user.name"] });
    const [out] = await commands.process("!greet wolfy", "invokingUser");
    expect(out).toBe("hi invokingUser");
  });

  test("function-type commands receive extracted {variable}s as the third argument", async () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    const handler = mock(async (_msg: string, _user?: string, vars?: Record<string, unknown>) => {
      return `queued ${vars?.songTitle}`;
    });
    commands.add("sr", handler, { variables: ["songTitle"] });
    const [out, matched] = await commands.process("!sr Life is a highway", "player");
    expect(matched).toBe(true);
    expect(out).toBe("queued Life is a highway");
    expect(handler).toHaveBeenCalledWith("Life is a highway", "player", { songTitle: "Life is a highway" }, {
      rawMessage: "!sr Life is a highway",
      args: ["Life", "is", "a", "highway"],
    });
  });

  test("commands with no declared variables are unaffected (vars is an empty object)", async () => {
    const commands = new Commands("#chan", makeChatClient() as never);
    const handler = mock(async (_msg: string, _user?: string, vars?: Record<string, unknown>) => {
      return JSON.stringify(vars);
    });
    commands.add("echo", handler);
    const [out] = await commands.process("!echo hello there", "player");
    expect(out).toBe("{}");
  });
});
