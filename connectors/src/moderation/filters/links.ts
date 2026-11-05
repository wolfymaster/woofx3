import { type LinksParams, normaliseHost, parseLinksParams } from "@woofx3/api/moderation-config";
import type { FilterVerdict, ModerationFilter, ModerationLine } from "../types";

/**
 * Top-level domains a bare `name.tld` counts as a link for. Deliberately
 * not every TLD: most two-letter country codes are also words or file
 * extensions, and reading "file.exe" or "gg.wp" as a link would delete
 * ordinary chat. A host under any other TLD is still a link when written
 * with a scheme or `www.`.
 */
const BARE_LINK_TLDS: ReadonlySet<string> = new Set([
  "com",
  "net",
  "org",
  "info",
  "biz",
  "xyz",
  "io",
  "tv",
  "gg",
  "co",
  "me",
  "ly",
  "to",
  "cc",
  "us",
  "uk",
  "de",
  "fr",
  "ru",
  "nl",
  "eu",
  "ca",
  "au",
  "br",
  "jp",
  "cn",
  "in",
  "es",
  "it",
  "app",
  "dev",
  "site",
  "online",
  "top",
  "live",
  "shop",
  "store",
  "club",
  "fun",
  "link",
  "click",
  "lol",
  "win",
  "bet",
  "vip",
  "pro",
  "art",
  "game",
  "games",
  "stream",
  "chat",
  "page",
  "website",
  "space",
  "tech",
  "cam",
  "porn",
  "sex",
  "xxx",
  "ws",
  "su",
  "cx",
  "gl",
  "sh",
]);

/** Characters that end a sentence or wrap a link, never part of its host. */
const WRAPPING = /^[("'<[{]+|[)"'>\]},.!?;:]+$/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** `example[.]com` and `example(.)com`, a common way to slip a link past a filter. */
const BRACKETED_DOT = /\[\.\]|\(\.\)/g;

/** The host each link in `text` points to, in ASCII form. */
export function linkedHosts(text: string): string[] {
  const hosts: string[] = [];
  for (const word of text.split(/\s+/)) {
    const host = linkHost(word);
    if (host !== null) {
      hosts.push(host);
    }
  }
  return hosts;
}

function linkHost(word: string): string | null {
  const token = word.replace(BRACKETED_DOT, ".").replace(WRAPPING, "");
  if (token === "" || token.startsWith("@")) {
    return null;
  }
  const hasScheme = SCHEME.test(token);
  const rest = token.replace(SCHEME, "");
  const hasWww = /^www\./i.test(rest);
  const authority = rest.split(/[/?#]/, 1)[0] ?? "";
  if (!hasScheme && authority.includes("@")) {
    return null;
  }
  const hostPart = authority.replace(/^[^@]*@/, "").replace(/:\d+$/, "");
  const host = normaliseHost(hostPart);
  if (host === null) {
    return null;
  }
  if (hasScheme || hasWww) {
    return host;
  }
  const tld = host.slice(host.lastIndexOf(".") + 1);
  return BARE_LINK_TLDS.has(tld) || tld.startsWith("xn--") ? host : null;
}

/** Whether `host` is an allowed domain or one of its subdomains; never by substring. */
export function isAllowedHost(host: string, allowDomains: readonly string[]): boolean {
  return allowDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export const linksFilter: ModerationFilter<LinksParams> = {
  id: "links",
  parseParams: parseLinksParams,
  evaluate(line: ModerationLine, params: LinksParams, env): FilterVerdict {
    if (env.permits.isPermitted(line.platform, line.chatterLogin)) {
      return { hit: false };
    }
    const blocked = linkedHosts(line.text).find((host) => !isAllowedHost(host, params.allowDomains));
    return blocked === undefined ? { hit: false } : { hit: true, reason: "posted a link to a website not on the list" };
  },
};
