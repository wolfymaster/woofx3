// Decides whether a direct address from a module's settings may be dialed for
// a module request, and which IP literal to dial. Module code sends arbitrary
// frames, so only the streamer's own network is reachable: loopback, private
// and link-local ranges, `localhost` and `.local` names. Every textual form a
// socket library would read as an IP is parsed here first, so `0x7f.1` or
// `::ffff:10.0.0.1` cannot slip past as a host name or as the wrong family.

import type { EngineHosting } from "@woofx3/api";

/** Resolves a host name to its IP addresses, as text. Rejects when the name does not resolve. */
export type NameResolver = (name: string) => Promise<string[]>;

/**
 * `dialIp` is the IP literal to dial, never a name: a name resolved here and
 * again by the socket could answer differently the second time.
 */
export type LocalAddressCheck = { ok: true; dialIp: string } | { ok: false; reason: string };

type IpLiteral = { family: 4; bytes: number[] } | { family: 6; bytes: number[] };

/** The address `localhost` dials; RFC 6761 reserves the name for loopback. */
const LOCALHOST_IP = "127.0.0.1";

const LOCAL_SUFFIX = ".local";

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Cloud metadata services, reachable from a VPS at these link-local addresses. */
const METADATA_V4 = [169, 254, 169, 254];
const METADATA_V6 = parseIpv6("fd00:ec2::254");

/**
 * Whether `host` may be dialed for a module request on an engine run as
 * `hosting`. A `.local` name is resolved once through `resolver`; every
 * answer must be allowed, and the first is dialed. A resolver failure refuses.
 */
export async function checkLocalAddress(
  host: string,
  hosting: EngineHosting | null,
  resolver: NameResolver
): Promise<LocalAddressCheck> {
  const name = unbracket(host.trim()).toLowerCase();
  if (name === "") {
    return refused("no address is set");
  }
  const literal = parseIp(name);
  if (literal !== null) {
    return checkLiteral(literal, hosting);
  }
  const bare = name.endsWith(".") ? name.slice(0, -1) : name;
  if (bare === "localhost") {
    return { ok: true, dialIp: LOCALHOST_IP };
  }
  if (!isLocalName(bare)) {
    return refused(`"${host}" is not a local network address; use an IP address on your network or a .local name`);
  }
  let answers: string[];
  try {
    answers = await resolver(bare);
  } catch (error) {
    return refused(`"${host}" did not resolve: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (answers.length === 0) {
    return refused(`"${host}" did not resolve to any address`);
  }
  let first: string | null = null;
  for (const answer of answers) {
    const ip = parseIp(answer.toLowerCase());
    if (ip === null) {
      return refused(`"${host}" resolved to "${answer}", which is not an IP address`);
    }
    const checked = checkLiteral(ip, hosting);
    if (!checked.ok) {
      return refused(`"${host}" resolved to ${answer}: ${checked.reason}`);
    }
    first ??= checked.dialIp;
  }
  return { ok: true, dialIp: first as string };
}

function checkLiteral(ip: IpLiteral, hosting: EngineHosting | null): LocalAddressCheck {
  if (ip.family === 6) {
    const mapped = ipv4Mapped(ip.bytes);
    return mapped === null ? checkIpv6(ip.bytes, hosting) : checkIpv4(mapped, hosting);
  }
  return checkIpv4(ip.bytes, hosting);
}

function checkIpv4(b: number[], hosting: EngineHosting | null): LocalAddressCheck {
  const text = b.join(".");
  if (sameBytes(b, METADATA_V4) && hosting !== "local") {
    return refused(`${text} is a cloud metadata address`);
  }
  const [a, second] = b as [number, number, number, number];
  const allowed =
    a === 127 ||
    a === 10 ||
    (a === 172 && second >= 16 && second <= 31) ||
    (a === 192 && second === 168) ||
    (a === 169 && second === 254);
  return allowed ? { ok: true, dialIp: text } : refused(`${text} is not a local network address`);
}

function checkIpv6(b: number[], hosting: EngineHosting | null): LocalAddressCheck {
  const text = formatIpv6(b);
  if (METADATA_V6 !== null && sameBytes(b, METADATA_V6) && hosting !== "local") {
    return refused(`${text} is a cloud metadata address`);
  }
  const loopback = b.slice(0, 15).every((byte) => byte === 0) && b[15] === 1;
  const linkLocal = b[0] === 0xfe && ((b[1] as number) & 0xc0) === 0x80;
  const uniqueLocal = ((b[0] as number) & 0xfe) === 0xfc;
  return loopback || linkLocal || uniqueLocal
    ? { ok: true, dialIp: text }
    : refused(`${text} is not a local network address`);
}

function isLocalName(name: string): boolean {
  if (!name.endsWith(LOCAL_SUFFIX) || name.length > 253) {
    return false;
  }
  const labels = name.split(".");
  return labels.length >= 2 && labels.every((label) => LABEL.test(label));
}

function parseIp(text: string): IpLiteral | null {
  if (text.includes(":")) {
    const bytes = parseIpv6(text);
    return bytes === null ? null : { family: 6, bytes };
  }
  const bytes = parseIpv4(text);
  return bytes === null ? null : { family: 4, bytes };
}

/**
 * IPv4 as inet_aton reads it: one to four parts, each decimal, octal (a
 * leading 0) or hex (0x), the last filling the remaining bytes. So
 * `2130706433`, `0177.1` and `0x7f.0.0.1` are all 127.0.0.1.
 */
function parseIpv4(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length > 4) {
    return null;
  }
  const values: number[] = [];
  for (const part of parts) {
    const value = parseIpv4Part(part);
    if (value === null) {
      return null;
    }
    values.push(value);
  }
  const last = values.pop() as number;
  if (values.some((value) => value > 255) || last >= 256 ** (4 - values.length)) {
    return null;
  }
  const bytes = [...values];
  for (let shift = 3 - values.length; shift >= 0; shift--) {
    bytes.push(Math.floor(last / 256 ** shift) % 256);
  }
  return bytes;
}

function parseIpv4Part(part: string): number | null {
  if (/^0x[0-9a-f]+$/.test(part)) {
    return Number.parseInt(part.slice(2), 16);
  }
  if (/^0[0-7]*$/.test(part)) {
    return Number.parseInt(part, 8);
  }
  if (/^[1-9][0-9]*$/.test(part)) {
    return Number(part);
  }
  return null;
}

/** IPv6 in any RFC 4291 text form, a zone id (`%eth0`) dropped and a dotted IPv4 tail allowed. */
function parseIpv6(text: string): number[] | null {
  const withoutZone = text.split("%")[0] as string;
  const halves = withoutZone.split("::");
  if (halves.length > 2) {
    return null;
  }
  const head = groups(halves[0] as string);
  const tail = halves.length === 2 ? groups(halves[1] as string) : [];
  if (head === null || tail === null) {
    return null;
  }
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) {
    return null;
  }
  const words = [...head, ...Array<number>(halves.length === 2 ? missing : 0).fill(0), ...tail];
  return words.flatMap((word) => [word >> 8, word & 0xff]);
}

/** Colon-separated hextets, the last of which may be a dotted IPv4 address (two hextets). */
function groups(text: string): number[] | null {
  if (text === "") {
    return [];
  }
  const parts = text.split(":");
  const words: number[] = [];
  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1 && part.includes(".")) {
      const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(part);
      const octets = v4?.slice(1).map(Number);
      if (octets === undefined || octets.some((octet) => octet > 255)) {
        return null;
      }
      const [a, b, c, d] = octets as [number, number, number, number];
      words.push((a << 8) | b, (c << 8) | d);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/.test(part)) {
      return null;
    }
    words.push(Number.parseInt(part, 16));
  }
  return words;
}

/** The IPv4 address inside `::ffff:a.b.c.d`, or null. */
function ipv4Mapped(b: number[]): number[] | null {
  const prefix = b.slice(0, 10).every((byte) => byte === 0) && b[10] === 0xff && b[11] === 0xff;
  return prefix ? b.slice(12) : null;
}

function formatIpv6(b: number[]): string {
  const words: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    words.push((((b[i] as number) << 8) | (b[i + 1] as number)).toString(16));
  }
  return words.join(":");
}

function unbracket(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function sameBytes(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function refused(reason: string): LocalAddressCheck {
  return { ok: false, reason };
}
