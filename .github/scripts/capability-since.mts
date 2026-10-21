// Fills in the Since column of the capability table in
// docs/services/engine-capabilities.md: the first release whose engine
// advertised each id. Convex retires a capability check once every supported
// engine is at least that version, so the value has to be right, and it is
// only known once the release is cut. Nobody writes it by hand.
//
// A release advertised an id when its tag's capabilities.ts declares the id
// and does not list it in UNADVERTISED_ENGINE_CAPABILITIES; an id can be
// declared releases before an engine serves it. An id no release advertised
// is `unreleased`, or `<tag>` when given the tag being cut now.
//
// Only empty and `unreleased` cells are filled, so a recorded value never
// changes and running it twice changes nothing. A row may also leave the
// Since cell out entirely (`| id | feature |`); it gets one.
//
// Usage:
//   node capability-since.mts          fill from the release tags
//   node capability-since.mts <tag>    also give ids shipping in <tag> that tag
//
// The release job runs it with the tag being cut as semantic-release's
// prepare step (.releaserc.json), so the values land in the release commit
// alongside the CHANGELOG.md entry. It needs every release tag fetched.
//
// The parsing and filling are exported for api/tests/capability-since.test.ts;
// only running the file reads git and writes the table.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const CAPABILITIES = "shared/clients/typescript/api/capabilities.ts";
// Also named by .releaserc.json's git assets and release.yml's check of the
// release commit; the three must match.
export const DOC = "docs/services/engine-capabilities.md";
export const UNRELEASED = "unreleased";

const VERSION = String.raw`v\d+\.\d+\.\d+`;
/** A release tag, as semantic-release cuts them (.releaserc.json tagFormat). */
export const RELEASE_TAG = new RegExp(`^${VERSION}$`);
/** A recorded Since value: the release tag, or `unreleased` until there is one. */
export const SINCE = new RegExp(`^(?:${VERSION}|${UNRELEASED})$`);

const ID = "[a-z][a-zA-Z0-9]*\\.[a-z][a-zA-Z0-9]*";

export interface Capabilities {
  declared: string[];
  advertised: ReadonlySet<string>;
}

export interface Row {
  /** The row's line index in the table document. */
  index: number;
  /** The recorded Since, or "" when the cell is empty or absent. */
  since: string;
  feature: string;
}

export interface Table {
  lines: string[];
  rows: Map<string, Row>;
}

/**
 * The ids a version of capabilities.ts declares, split by whether its engine
 * advertises them. Throws when the source does not parse, since a silent miss
 * would record a wrong Since. Only the current file must have the
 * UNADVERTISED_ENGINE_CAPABILITIES block; older tags may predate it.
 */
export function parseCapabilities(
  source: string,
  { requireUnadvertised }: { requireUnadvertised: boolean }
): Capabilities {
  const idsByKey = new Map<string, string>();
  for (const [, key, id] of source.matchAll(new RegExp(`^\\s*(\\w+): "(${ID})",`, "gm"))) {
    idsByKey.set(key, id);
  }
  if (idsByKey.size === 0) {
    throw new Error(`${CAPABILITIES} declares no capability ids this script can read`);
  }
  const unadvertised = new Set<string>();
  const block = source.match(/export const UNADVERTISED_ENGINE_CAPABILITIES\b[\s\S]*?\]\);/);
  if (block) {
    for (const [, key] of block[0].matchAll(/ENGINE_CAPABILITIES\.(\w+)/g)) {
      const id = idsByKey.get(key);
      if (id === undefined) {
        throw new Error(`UNADVERTISED_ENGINE_CAPABILITIES names ${key}, which ENGINE_CAPABILITIES does not declare`);
      }
      unadvertised.add(id);
    }
  } else if (requireUnadvertised) {
    throw new Error(`${CAPABILITIES} has no UNADVERTISED_ENGINE_CAPABILITIES block this script can read`);
  }
  const declared = [...idsByKey.values()];
  return { declared, advertised: new Set(declared.filter((id) => !unadvertised.has(id))) };
}

/**
 * The capability rows of the table document: `| \`id\` | since | feature |`,
 * or `| \`id\` | feature |` before a row has a Since cell. Cells split on
 * unescaped pipes, so a feature may contain `\|`. A row with another cell
 * count or a malformed Since throws with its line number.
 */
export function parseTable(doc: string): Table {
  const rowStart = new RegExp(`^\\| \`(${ID})\` \\|`);
  const rows = new Map<string, Row>();
  const lines = doc.split("\n");
  lines.forEach((line, index) => {
    const match = line.match(rowStart);
    if (!match) {
      return;
    }
    const id = match[1];
    const cells = line
      .replace(/\r$/, "")
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((cell) => cell.trim());
    const where = `${DOC}:${index + 1}`;
    if (cells.length === 2) {
      rows.set(id, { index, since: "", feature: cells[1] });
      return;
    }
    if (cells.length !== 3) {
      throw new Error(`${where}: the ${id} row has ${cells.length} cells; expected | Id | Since | Feature |`);
    }
    const [, since, feature] = cells;
    if (since !== "" && !SINCE.test(since)) {
      throw new Error(`${where}: the ${id} row's Since is "${since}"; expected empty, ${UNRELEASED} or vX.Y.Z`);
    }
    rows.set(id, { index, since, feature });
  });
  return { lines, rows };
}

/** Declared ids the table has no row for. */
export function missingRows(current: Capabilities, table: Table): string[] {
  return current.declared.filter((id) => !table.rows.has(id));
}

/** Declared ids whose row has no Since yet: empty, absent or `unreleased`. */
export function unfilledIds(current: Capabilities, table: Table): string[] {
  return current.declared.filter((id) => {
    const since = table.rows.get(id)?.since;
    return since === "" || since === UNRELEASED;
  });
}

/**
 * The first release tag advertising each id in `ids`; ids no release
 * advertised are left out. `tags` is in version order, and tags that are not
 * releases are skipped. `read` returns a tag's capabilities.ts, or undefined
 * when the tag predates it.
 */
export function firstReleases(
  ids: readonly string[],
  tags: readonly string[],
  read: (tag: string) => string | undefined
): Map<string, string> {
  const since = new Map<string, string>();
  for (const tag of tags) {
    if (since.size === ids.length) {
      break;
    }
    if (!RELEASE_TAG.test(tag)) {
      continue;
    }
    const source = read(tag);
    if (source === undefined) {
      continue;
    }
    for (const id of parseCapabilities(source, { requireUnadvertised: false }).advertised) {
      if (ids.includes(id) && !since.has(id)) {
        since.set(id, tag);
      }
    }
  }
  return since;
}

/**
 * The table document with each unfilled row given its first release from
 * `found`, `releasing` for an advertised id no earlier release shipped, and
 * `unreleased` otherwise.
 */
export function fillTable(
  current: Capabilities,
  table: Table,
  found: ReadonlyMap<string, string>,
  releasing?: string
): string {
  const lines = [...table.lines];
  for (const id of unfilledIds(current, table)) {
    const row = table.rows.get(id);
    if (row === undefined) {
      continue;
    }
    let since = found.get(id) ?? UNRELEASED;
    if (since === UNRELEASED && releasing !== undefined && current.advertised.has(id)) {
      since = releasing;
    }
    const cr = lines[row.index].endsWith("\r") ? "\r" : "";
    lines[row.index] = `| \`${id}\` | ${since} | ${row.feature} |${cr}`;
  }
  return lines.join("\n");
}

function main(args: string[]): void {
  const releasing = args[0];
  if (args.length > 1 || (releasing !== undefined && !RELEASE_TAG.test(releasing))) {
    throw new Error(`usage: capability-since.mts [vX.Y.Z]; got ${args.join(" ")}`);
  }

  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const git = (...gitArgs: string[]) =>
    execFileSync("git", gitArgs, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  const current = parseCapabilities(readFileSync(path.join(root, CAPABILITIES), "utf8"), {
    requireUnadvertised: true,
  });
  const docPath = path.join(root, DOC);
  const doc = readFileSync(docPath, "utf8");
  const table = parseTable(doc);

  // A release must not ship an id without recording its Since, so a missing
  // row fails, the release's prepare step included.
  const missing = missingRows(current, table);
  if (missing.length > 0) {
    for (const id of missing) {
      console.error(`${DOC} has no row for ${id}; add one to the capability table.`);
    }
    process.exit(1);
  }

  const tags = git("tag", "--list", "v*", "--sort=v:refname").split("\n");
  // Only a tag without the file predates capabilities.ts. Any other git
  // failure throws: skipping the tag would record a later one as the Since.
  const read = (tag: string) =>
    git("ls-tree", "--name-only", tag, "--", CAPABILITIES).trim() === ""
      ? undefined
      : git("show", `${tag}:${CAPABILITIES}`);
  const found = firstReleases(unfilledIds(current, table), tags, read);

  const updated = fillTable(current, table, found, releasing);
  if (updated !== doc) {
    writeFileSync(docPath, updated);
    console.log(`Updated ${DOC}`);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2));
}
