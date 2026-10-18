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
//   node capability-since.mjs            fill from the release tags
//   node capability-since.mjs <tag>      also give ids shipping in <tag> that tag
//   node capability-since.mjs --check    exit 1 if the table would change
//
// The release job runs it with the tag being cut as semantic-release's
// prepare step (.releaserc.json), so the values land in the release commit
// alongside the CHANGELOG.md entry. It needs every release tag fetched.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const CAPABILITIES = "shared/clients/typescript/api/capabilities.ts";
const DOC = "docs/services/engine-capabilities.md";
const UNRELEASED = "unreleased";
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;
const ID = "[a-z][a-zA-Z0-9]*\\.[a-z][a-zA-Z0-9]*";

const args = process.argv.slice(2);
const check = args.includes("--check");
const releasing = args.find((arg) => arg !== "--check");
if (releasing !== undefined && !RELEASE_TAG.test(releasing)) {
  throw new Error(`usage: capability-since.mjs [--check] [vX.Y.Z]; got ${releasing}`);
}

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

function git(...gitArgs) {
  return execFileSync("git", gitArgs, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** The ids a version of capabilities.ts declares, split by whether its engine advertises them. */
function parseCapabilities(source) {
  const idsByKey = new Map();
  for (const [, key, id] of source.matchAll(new RegExp(`^\\s*(\\w+): "(${ID})",`, "gm"))) {
    idsByKey.set(key, id);
  }
  const unadvertised = new Set();
  const block = source.match(/export const UNADVERTISED_ENGINE_CAPABILITIES\b[\s\S]*?\]\);/);
  if (block) {
    for (const [, key] of block[0].matchAll(/ENGINE_CAPABILITIES\.(\w+)/g)) {
      unadvertised.add(idsByKey.get(key));
    }
  }
  const declared = [...idsByKey.values()];
  return { declared, advertised: new Set(declared.filter((id) => !unadvertised.has(id))) };
}

function releaseTags() {
  return git("tag", "--list", "v*", "--sort=v:refname")
    .split("\n")
    .filter((tag) => RELEASE_TAG.test(tag));
}

/** The first release tag advertising each id in `ids`; ids no release advertised are left out. */
function firstReleases(ids) {
  const since = new Map();
  for (const tag of releaseTags()) {
    if (since.size === ids.length) {
      break;
    }
    let source;
    try {
      source = git("show", `${tag}:${CAPABILITIES}`);
    } catch {
      continue; // predates capabilities.ts
    }
    for (const id of parseCapabilities(source).advertised) {
      if (ids.includes(id) && !since.has(id)) {
        since.set(id, tag);
      }
    }
  }
  return since;
}

const current = parseCapabilities(readFileSync(path.join(root, CAPABILITIES), "utf8"));
const docPath = path.join(root, DOC);
const doc = readFileSync(docPath, "utf8");

// `| \`id\` | since | feature |`, or `| \`id\` | feature |` before it has a Since cell.
const row = new RegExp(`^\\| \`(${ID})\` \\|\\s*(.*?)\\s*\\|(?:\\s*(.*?)\\s*\\|)?$`);
const rows = new Map();
const lines = doc.split("\n");
lines.forEach((line, index) => {
  const match = line.match(row);
  if (!match) {
    return;
  }
  const [, id, second, rest] = match;
  const hasSince = rest !== undefined && (second === "" || second === UNRELEASED || RELEASE_TAG.test(second));
  rows.set(id, {
    index,
    since: hasSince ? second : "",
    feature: hasSince ? rest : rest === undefined ? second : `${second} | ${rest}`,
  });
});

const missingRows = current.declared.filter((id) => !rows.has(id));
for (const id of missingRows) {
  console.error(`${DOC} has no row for ${id}; add one to the capability table.`);
}

const unfilled = current.declared.filter((id) => rows.has(id) && ["", UNRELEASED].includes(rows.get(id).since));
const found = firstReleases(unfilled);
for (const id of unfilled) {
  const entry = rows.get(id);
  let since = found.get(id) ?? UNRELEASED;
  if (since === UNRELEASED && releasing && current.advertised.has(id)) {
    since = releasing;
  }
  lines[entry.index] = `| \`${id}\` | ${since} | ${entry.feature} |`;
}

const updated = lines.join("\n");
if (check) {
  if (updated !== doc || missingRows.length > 0) {
    console.error(`${DOC} is missing Since values; run node .github/scripts/capability-since.mjs`);
    process.exit(1);
  }
} else if (updated !== doc) {
  writeFileSync(docPath, updated);
  console.log(`Updated ${DOC}`);
}
