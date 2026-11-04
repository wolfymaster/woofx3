import { describe, expect, test } from "bun:test";
import { DEFAULT_LINKS_PARAMS, MODERATION_LIMITS, parseLinksParams } from "@woofx3/api/moderation-config";
import { MemoryPermitStore } from "../permit-store";
import { filterEnv, moderationLine, PLATFORM } from "../testing";
import { isAllowedHost, linkedHosts, linksFilter } from "./links";

describe("linkedHosts", () => {
  const rows: Array<[name: string, text: string, hosts: string[]]> = [
    ["an https link", "go to https://example.com/page now", ["example.com"]],
    ["an http link with a port and query", "http://Example.COM:8080/?a=1", ["example.com"]],
    ["www. without a scheme", "www.example.org", ["www.example.org"]],
    ["a bare domain with a known TLD", "check example.com", ["example.com"]],
    ["a bare domain with a path", "example.tv/clip/abc", ["example.tv"]],
    ["a bracketed dot", "example[.]com", ["example.com"]],
    ["a parenthesised dot", "example(.)com", ["example.com"]],
    ["trailing punctuation", "see example.com.", ["example.com"]],
    ["wrapped in brackets and quotes", '("example.com")', ["example.com"]],
    ["a unicode domain, as punycode", "https://пример.рф", ["xn--e1afmkfd.xn--p1ai"]],
    ["a bare unicode domain under an IDN TLD", "пример.рф", ["xn--e1afmkfd.xn--p1ai"]],
    ["a punycode domain", "xn--e1afmkfd.com", ["xn--e1afmkfd.com"]],
    ["two links", "a.com and b.net", ["a.com", "b.net"]],
    ["an ambiguous TLD written bare", "grab notes.zip", []],
    ["an ambiguous TLD with a scheme", "https://notes.zip", ["notes.zip"]],
    ["an ambiguous TLD with www.", "www.notes.mov", ["www.notes.mov"]],
    ["a file name", "run setup.exe", []],
    ["a code file", "edit main.py", []],
    ["an @mention with a dot", "@mention.name hi", []],
    ["an email address", "mail me@example.com", []],
    ["a dotted abbreviation", "e.g. this", []],
    ["an ellipsis", "wait...what", []],
    ["a decimal number", "it costs 4.99", []],
    ["an emote name", "LUL PogChamp Kappa", []],
    ["no dots at all", "hello chat", []],
  ];
  for (const [name, text, hosts] of rows) {
    test(name, () => {
      expect(linkedHosts(text)).toEqual(hosts);
    });
  }
});

describe("isAllowedHost", () => {
  const rows: Array<[host: string, allowed: boolean]> = [
    ["example.tv", true],
    ["clips.example.tv", true],
    ["www.example.tv", true],
    ["example.tv.evil.com", false],
    ["notexample.tv", false],
    ["evil.com", false],
  ];
  for (const [host, allowed] of rows) {
    test(`${host} against example.tv`, () => {
      expect(isAllowedHost(host, ["example.tv"])).toBe(allowed);
    });
  }
});

describe("linksFilter", () => {
  const params = { allowDomains: ["example.tv"], permitSeconds: 60 };

  test("hits a link to a website not on the list", async () => {
    const verdict = await linksFilter.evaluate(moderationLine({ text: "free stuff at evil.com" }), params, filterEnv());
    expect(verdict.hit).toBe(true);
  });

  test("passes a link on the list, and its subdomains", async () => {
    const line = moderationLine({ text: "https://clips.example.tv/abc and example.tv" });
    expect(await linksFilter.evaluate(line, params, filterEnv())).toEqual({ hit: false });
  });

  test("hits when any one of several links is not on the list", async () => {
    const line = moderationLine({ text: "example.tv then example.tv.evil.com" });
    expect((await linksFilter.evaluate(line, params, filterEnv())).hit).toBe(true);
  });

  test("passes a viewer with a permit, until it runs out", async () => {
    let now = 0;
    const clock = { now: () => now };
    const permits = new MemoryPermitStore(10, clock);
    permits.grant(PLATFORM, "Viewer_One", 60);
    const line = moderationLine({ text: "evil.com", chatterLogin: "viewer_one" });
    expect((await linksFilter.evaluate(line, params, filterEnv({ permits, clock }))).hit).toBe(false);
    now = 60_000;
    expect((await linksFilter.evaluate(line, params, filterEnv({ permits, clock }))).hit).toBe(true);
  });
});

describe("parseLinksParams", () => {
  test("takes the defaults", () => {
    expect(parseLinksParams(DEFAULT_LINKS_PARAMS)).toEqual({ ok: true, value: DEFAULT_LINKS_PARAMS });
  });

  test("normalises allowed websites to lower-case ASCII host names, without scheme or www., once each", () => {
    const parsed = parseLinksParams({
      allowDomains: ["https://www.Example.TV/", "example.tv", "пример.рф"],
      permitSeconds: 30,
    });
    expect(parsed).toEqual({
      ok: true,
      value: { allowDomains: ["example.tv", "xn--e1afmkfd.xn--p1ai"], permitSeconds: 30 },
    });
  });

  const invalid: Array<[name: string, raw: unknown, error: string]> = [
    ["not an object", [], "must be an object"],
    ["an unknown field", { ...DEFAULT_LINKS_PARAMS, extra: 1 }, 'unknown field "extra"'],
    ["no permitSeconds", { allowDomains: [] }, "permitSeconds is required"],
    ["a website that is not a host", { allowDomains: ["not a site"], permitSeconds: 60 }, "is not a website name"],
    ["a single label", { allowDomains: ["localhost"], permitSeconds: 60 }, "is not a website name"],
    ["a non-string website", { allowDomains: [3], permitSeconds: 60 }, "allowDomains[0] must be a website name"],
    [
      "too many websites",
      {
        allowDomains: Array.from({ length: MODERATION_LIMITS.maxAllowDomains + 1 }, (_, i) => `s${i}.com`),
        permitSeconds: 60,
      },
      "at most 200",
    ],
    ["a negative permit", { allowDomains: [], permitSeconds: -1 }, "permitSeconds must be a whole number"],
    ["a permit over an hour", { allowDomains: [], permitSeconds: 3_601 }, "permitSeconds must be a whole number"],
    ["a fractional permit", { allowDomains: [], permitSeconds: 1.5 }, "permitSeconds must be a whole number"],
  ];
  for (const [name, raw, error] of invalid) {
    test(`refuses ${name}`, () => {
      const parsed = parseLinksParams(raw);
      expect(parsed.ok).toBe(false);
      expect(parsed.ok ? "" : parsed.error).toContain(error);
    });
  }
});
