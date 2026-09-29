// Prints, as markdown, the release that semantic-release would cut if HEAD
// were master: the version, and the notes that go into the GitHub release and
// CHANGELOG.md. The release-preview workflow checks out a pull request's merge
// ref and posts this on the pull request.
//
// semantic-release itself cannot answer this: it refuses to release anything
// but the tip of master, dry run included. So this runs the same two plugins,
// with their configuration read from .releaserc.json, over the commits since
// the last v* tag reachable from HEAD, and bumps the version as
// semantic-release does.
//
// Usage: node release-preview.mjs <semantic-release node_modules dir>

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const modules = process.argv[2];
if (!modules) {
  throw new Error("usage: release-preview.mjs <semantic-release node_modules dir>");
}

const require = createRequire(path.join(modules, "noop.js"));
const semver = require("semver");
const { analyzeCommits } = await import(path.join(modules, "@semantic-release/commit-analyzer/index.js"));
const { generateNotes } = await import(path.join(modules, "@semantic-release/release-notes-generator/index.js"));

const cwd = process.cwd();
const config = JSON.parse(readFileSync(path.join(cwd, ".releaserc.json"), "utf8"));
const tagPrefix = config.tagFormat.replace("${version}", "");
if (`${tagPrefix}\${version}` !== config.tagFormat) {
  throw new Error(`tagFormat ${config.tagFormat} must be a prefix followed by \${version}`);
}

function pluginConfig(name) {
  for (const plugin of config.plugins) {
    const [pluginName, options] = Array.isArray(plugin) ? plugin : [plugin, {}];
    if (pluginName === name) {
      return options;
    }
  }
  throw new Error(`.releaserc.json does not configure ${name}`);
}

function git(...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

const lastVersion = git("tag", "--merged", "HEAD", "--list", `${tagPrefix}*`)
  .split("\n")
  .map((tag) => tag.slice(tagPrefix.length))
  .filter((version) => semver.valid(version) && !semver.prerelease(version))
  .sort(semver.rcompare)[0];
if (!lastVersion) {
  throw new Error(`no ${tagPrefix}* release tag is reachable from HEAD`);
}
const lastTag = `${tagPrefix}${lastVersion}`;

// Fields are separated by NUL and records by the ASCII record separator, which
// neither a hash, a date nor a commit message contains.
const commits = git("log", "--format=%H%x00%cI%x00%B%x1e", `${lastTag}..HEAD`)
  .split("\x1e")
  .map((record) => record.replace(/^\n/, ""))
  .filter((record) => record !== "")
  .map((record) => {
    const [hash, committerDate, message] = record.split("\0");
    return { hash, committerDate, message: message.trimEnd() };
  });

const silent = { log() {}, info() {}, warn() {}, success() {}, error: console.error };
const context = { cwd, env: process.env, logger: silent, commits, options: config };

const type = await analyzeCommits(pluginConfig("@semantic-release/commit-analyzer"), context);

const marker = "<!-- release-preview -->";
if (!type) {
  console.log(`${marker}
### Release preview

Merging this pull request into \`master\` releases **nothing**: none of the ${commits.length} commits since \`${lastTag}\` is a \`feat\`, \`fix\`, \`perf\` or breaking change.`);
  process.exit(0);
}

const version = semver.inc(lastVersion, type);
const nextTag = `${tagPrefix}${version}`;
const repositoryUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY ?? "wolfymaster/woofx3"}`;
const notes = await generateNotes(pluginConfig("@semantic-release/release-notes-generator"), {
  ...context,
  options: { ...config, repositoryUrl },
  lastRelease: { version: lastVersion, gitTag: lastTag },
  nextRelease: { version, gitTag: nextTag, type },
});

console.log(`${marker}
### Release preview

Merging this pull request into \`master\` releases **${nextTag}**, a ${type} bump from \`${lastTag}\` (${commits.length} commits).

Merge it with a merge commit. A squash merge replaces these commits with one titled after the pull request, and semantic-release reads only commit messages.

<details>
<summary>Release notes and CHANGELOG.md entry</summary>

${notes.trim()}

</details>`);
