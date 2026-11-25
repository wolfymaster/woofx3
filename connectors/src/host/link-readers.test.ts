import { describe, expect, test } from "bun:test";
import {
  KICK_TOKEN_SETTING,
  kickLinkReader,
  type LinkReader,
  type LinkStore,
  TWITCH_TOKEN_SETTING,
  twitchLinkReader,
} from "./link-readers";
import { fixedLinkStore } from "./testing";

const settings = (values: Record<string, string | null>) => fixedLinkStore(values);

const TOKEN_READERS: Array<[name: string, reader: LinkReader, tokenSetting: string, flagSetting: string]> = [
  ["twitch", twitchLinkReader, TWITCH_TOKEN_SETTING, "integration.twitch.enabled"],
  ["kick", kickLinkReader, KICK_TOKEN_SETTING, "integration.kick.enabled"],
];

describe.each(TOKEN_READERS)("%s link reader", (_name, reader, tokenSetting, flagSetting) => {
  const cases: Array<{
    name: string;
    token: string | null;
    flag: string | null;
    connected: boolean;
    enabled: boolean;
    kind: "set" | "absent" | "invalid";
  }> = [
    { name: "no token, no flag", token: null, flag: null, connected: false, enabled: false, kind: "absent" },
    { name: "blank token after unlink", token: "", flag: "false", connected: false, enabled: false, kind: "set" },
    { name: "whitespace token", token: "  ", flag: null, connected: false, enabled: false, kind: "absent" },
    {
      name: "linked before the flag existed",
      token: "tok",
      flag: null,
      connected: true,
      enabled: true,
      kind: "absent",
    },
    { name: "linked and enabled", token: "tok", flag: "true", connected: true, enabled: true, kind: "set" },
    { name: "linked and disabled", token: "tok", flag: "false", connected: true, enabled: false, kind: "set" },
    {
      name: "invalid flag follows connected",
      token: "tok",
      flag: "yes",
      connected: true,
      enabled: true,
      kind: "invalid",
    },
    { name: "enabled without a token", token: null, flag: "true", connected: false, enabled: true, kind: "set" },
  ];
  for (const c of cases) {
    test(c.name, async () => {
      const reading = await reader.read(settings({ [tokenSetting]: c.token, [flagSetting]: c.flag }));
      expect({ connected: reading.connected, enabled: reading.enabled, kind: reading.flag?.kind }).toEqual({
        connected: c.connected,
        enabled: c.enabled,
        kind: c.kind,
      });
    });
  }

  test("a failed settings read rejects rather than reading as unlinked", async () => {
    const failing: LinkStore = {
      getSetting: async () => {
        throw new Error("db-proxy is down");
      },
      installedModules: async () => [],
    };
    await expect(reader.read(failing)).rejects.toThrow("db-proxy is down");
  });
});
