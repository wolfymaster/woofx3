import { describe, expect, test } from "bun:test";
import type { EngineHosting } from "@woofx3/api";
import { checkLocalAddress, type NameResolver } from "./local-address";

const noResolver: NameResolver = async (name) => {
  throw new Error(`no resolution for ${name} in this test`);
};

const answers =
  (table: Record<string, string[]>): NameResolver =>
  async (name) => {
    const found = table[name];
    if (found === undefined) {
      throw new Error(`ENOTFOUND ${name}`);
    }
    return found;
  };

describe("checkLocalAddress literals", () => {
  const allowed: Array<[name: string, host: string, dialIp: string]> = [
    ["loopback", "127.0.0.1", "127.0.0.1"],
    ["the top of loopback", "127.255.255.254", "127.255.255.254"],
    ["10/8", "10.1.2.3", "10.1.2.3"],
    ["the bottom of 172.16/12", "172.16.0.1", "172.16.0.1"],
    ["the top of 172.16/12", "172.31.255.1", "172.31.255.1"],
    ["192.168/16", "192.168.1.20", "192.168.1.20"],
    ["link-local", "169.254.10.20", "169.254.10.20"],
    ["a decimal integer", "2130706433", "127.0.0.1"],
    ["octal parts", "0177.0.0.01", "127.0.0.1"],
    ["hex parts", "0x7f.0x0.0x0.0x1", "127.0.0.1"],
    ["a hex integer", "0xc0a80114", "192.168.1.20"],
    ["two parts, the last filling three bytes", "10.65536", "10.1.0.0"],
    ["three parts, the last filling two bytes", "192.168.276", "192.168.1.20"],
    ["padded with spaces", "  192.168.1.20 ", "192.168.1.20"],
    ["IPv6 loopback", "::1", "0:0:0:0:0:0:0:1"],
    ["IPv6 loopback in brackets", "[::1]", "0:0:0:0:0:0:0:1"],
    ["IPv6 link-local with a zone id", "fe80::1%eth0", "fe80:0:0:0:0:0:0:1"],
    ["the top of fe80::/10", "febf::1", "febf:0:0:0:0:0:0:1"],
    ["unique local fc00::/7", "fd12:3456::1", "fd12:3456:0:0:0:0:0:1"],
    ["uppercase IPv6", "FD12::A", "fd12:0:0:0:0:0:0:a"],
    ["IPv4-mapped private, as IPv4", "::ffff:192.168.1.20", "192.168.1.20"],
    ["IPv4-mapped in hex hextets", "::ffff:c0a8:114", "192.168.1.20"],
    ["IPv4-mapped written out in full", "0:0:0:0:0:ffff:7f00:1", "127.0.0.1"],
  ];
  for (const [name, host, dialIp] of allowed) {
    test(`allows ${name}`, async () => {
      expect(await checkLocalAddress(host, "self", noResolver)).toEqual({ ok: true, dialIp });
    });
  }

  const refused: Array<[name: string, host: string, hosting: EngineHosting | null, reason: string]> = [
    ["a public address", "8.8.8.8", "self", "8.8.8.8 is not a local network address"],
    ["a public decimal integer", "134744072", "self", "8.8.8.8 is not a local network address"],
    ["just past 172.16/12", "172.32.0.1", "self", "172.32.0.1 is not a local network address"],
    ["the unspecified address", "0.0.0.0", "local", "0.0.0.0 is not a local network address"],
    ["a bare zero", "0", "local", "0.0.0.0 is not a local network address"],
    ["broadcast", "255.255.255.255", "local", "255.255.255.255 is not a local network address"],
    ["multicast", "224.0.0.251", "local", "224.0.0.251 is not a local network address"],
    ["cloud metadata on self", "169.254.169.254", "self", "169.254.169.254 is a cloud metadata address"],
    ["cloud metadata on managed", "169.254.169.254", "managed", "is a cloud metadata address"],
    ["cloud metadata with hosting unset", "169.254.169.254", null, "is a cloud metadata address"],
    ["cloud metadata in hex", "0xa9fea9fe", "self", "169.254.169.254 is a cloud metadata address"],
    ["cloud metadata IPv4-mapped", "::ffff:169.254.169.254", "self", "169.254.169.254 is a cloud metadata address"],
    ["IPv6 cloud metadata", "fd00:ec2::254", "self", "fd00:ec2:0:0:0:0:0:254 is a cloud metadata address"],
    ["IPv4-mapped public", "::ffff:8.8.8.8", "local", "8.8.8.8 is not a local network address"],
    ["IPv4-mapped public in hex hextets", "::ffff:808:808", "local", "8.8.8.8 is not a local network address"],
    ["the IPv6 unspecified address", "::", "local", "0:0:0:0:0:0:0:0 is not a local network address"],
    ["IPv6 multicast", "ff02::fb", "local", "ff02:0:0:0:0:0:0:fb is not a local network address"],
    ["a public IPv6 address", "2001:4860:4860::8888", "local", "is not a local network address"],
    ["NAT64 of a private address", "64:ff9b::c0a8:114", "local", "is not a local network address"],
    ["an IPv4 part past 255", "192.168.1.256", "local", "is not a local network address; use an IP address"],
    ["too many IPv4 parts", "1.2.3.4.5", "local", "is not a local network address; use an IP address"],
    ["a malformed IPv6 address", "fe80:::1", "local", "is not a local network address; use an IP address"],
    ["a public host name", "example.com", "local", '"example.com" is not a local network address'],
    ["a name under localhost", "evil.localhost", "local", "is not a local network address"],
    ["a name ending in local but not .local", "notlocal", "local", "is not a local network address"],
    ["an empty host", "  ", "local", "no address is set"],
  ];
  for (const [name, host, hosting, reason] of refused) {
    test(`refuses ${name}`, async () => {
      const checked = await checkLocalAddress(host, hosting, noResolver);
      expect(checked.ok).toBe(false);
      expect(checked.ok ? "" : checked.reason).toContain(reason);
    });
  }

  test("allows cloud metadata only on a local engine, where it is the streamer's own network", async () => {
    expect(await checkLocalAddress("169.254.169.254", "local", noResolver)).toEqual({
      ok: true,
      dialIp: "169.254.169.254",
    });
    expect(await checkLocalAddress("fd00:ec2::254", "local", noResolver)).toEqual({
      ok: true,
      dialIp: "fd00:ec2:0:0:0:0:0:254",
    });
  });
});

describe("checkLocalAddress names", () => {
  test("localhost dials loopback without asking the resolver", async () => {
    expect(await checkLocalAddress("LocalHost.", "self", noResolver)).toEqual({ ok: true, dialIp: "127.0.0.1" });
  });

  test("a .local name dials the first address it resolves to", async () => {
    const resolver = answers({ "studio-pc.local": ["192.168.1.20", "fe80::1"] });
    expect(await checkLocalAddress("Studio-PC.local", "self", resolver)).toEqual({
      ok: true,
      dialIp: "192.168.1.20",
    });
  });

  test("a .local name is resolved exactly once", async () => {
    let asked = 0;
    const resolver: NameResolver = async () => {
      asked++;
      return ["10.0.0.5"];
    };
    await checkLocalAddress("lights.local", "self", resolver);
    expect(asked).toBe(1);
  });

  const refused: Array<[name: string, table: Record<string, string[]>, reason: string]> = [
    ["resolving to a public address", { "vts.local": ["8.8.8.8"] }, '"vts.local" resolved to 8.8.8.8'],
    [
      "with any one public answer",
      { "vts.local": ["192.168.1.20", "8.8.8.8"] },
      '"vts.local" resolved to 8.8.8.8: 8.8.8.8 is not a local network address',
    ],
    ["resolving to cloud metadata", { "vts.local": ["169.254.169.254"] }, "is a cloud metadata address"],
    ["resolving to nothing", { "vts.local": [] }, '"vts.local" did not resolve to any address'],
    ["resolving to something that is not an IP", { "vts.local": ["vts.example"] }, "which is not an IP address"],
    ["that does not resolve", {}, '"vts.local" did not resolve: ENOTFOUND vts.local'],
  ];
  for (const [name, table, reason] of refused) {
    test(`refuses a .local name ${name}`, async () => {
      const checked = await checkLocalAddress("vts.local", "self", answers(table));
      expect(checked.ok).toBe(false);
      expect(checked.ok ? "" : checked.reason).toContain(reason);
    });
  }

  test("refuses a .local name with a malformed label without resolving it", async () => {
    const checked = await checkLocalAddress("-bad-.local", "self", noResolver);
    expect(checked).toEqual({
      ok: false,
      reason: '"-bad-.local" is not a local network address; use an IP address on your network or a .local name',
    });
  });
});
