import type { ModuleFileEntry } from "@woofx3/api";
import { strFromU8, type UnzipFileInfo, unzipSync } from "fflate";

/**
 * Reading a module archive the engine has not installed yet: the manifest
 * barkloader would install from, and the files it would serve afterwards.
 *
 * The archive is chosen and walked by barkloader's rules, so what a streamer
 * reviews before an install is what the install uses. Must match
 * `manifest_file_rank` in barkloader/lib_module and the root and junk rules
 * in barkloader/app/src/routes/archives.rs.
 */

/** Manifest names barkloader accepts, best first, compared on the last path segment case-insensitively. */
const MANIFEST_NAMES = ["manifest.json", "manifest.yaml", "manifest.yml", "module.json", "module.yaml", "module.yml"];

/** Entries archiving tools add beside a module's own files. */
const JUNK_SEGMENTS: ReadonlySet<string> = new Set(["__MACOSX", ".DS_Store"]);

/**
 * The largest manifest inflated. Real manifests are a few kilobytes; the cap
 * keeps an entry whose header claims gigabytes from being inflated at all.
 */
const MAX_MANIFEST_BYTES = 1024 * 1024;

export interface ModuleArchiveContents {
  manifest: Record<string, unknown>;
  /** The module's files relative to its root, sorted by path, as `listModuleFiles` lists them. */
  files: ModuleFileEntry[];
}

function manifestRank(name: string): number | null {
  const lower = name.replace(/\\/g, "/").toLowerCase();
  const rank = MANIFEST_NAMES.findIndex((suffix) => lower === suffix || lower.endsWith(`/${suffix}`));
  return rank === -1 ? null : rank;
}

/** A member name as a relative path, or null when it climbs out with `..`. */
function normalizeArchivePath(name: string): string | null {
  let normalized = name;
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  normalized = normalized.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.split("/").some((segment) => segment === "..")) {
    return null;
  }
  return normalized;
}

function isJunk(path: string): boolean {
  return path.split("/").some((segment) => JUNK_SEGMENTS.has(segment));
}

/** The member barkloader installs the manifest from: best-ranked name first, then the shallowest. */
function chooseManifest(headers: readonly UnzipFileInfo[]): { header: UnzipFileInfo; root: string } | null {
  let best: { header: UnzipFileInfo; rank: number; depth: number; root: string } | null = null;
  for (const header of headers) {
    const rank = manifestRank(header.name);
    const normalized = normalizeArchivePath(header.name);
    if (rank === null || normalized === null || isJunk(normalized)) {
      continue;
    }
    const depth = normalized.split("/").length - 1;
    if (best === null || rank < best.rank || (rank === best.rank && depth < best.depth)) {
      const slash = normalized.lastIndexOf("/");
      best = { header, rank, depth, root: slash === -1 ? "" : normalized.slice(0, slash + 1) };
    }
  }
  return best === null ? null : { header: best.header, root: best.root };
}

function modulePath(root: string, name: string): string | null {
  if (name.endsWith("/")) {
    return null;
  }
  const normalized = normalizeArchivePath(name);
  if (normalized === null || !normalized.startsWith(root)) {
    return null;
  }
  const rel = normalized.slice(root.length);
  if (rel === "" || isJunk(rel)) {
    return null;
  }
  return rel;
}

/**
 * The manifest and file list of a module archive. Throws when the archive is
 * not a zip, has no manifest, or its manifest is not a JSON object: a YAML
 * manifest installs, but the engine cannot show it for review, and an
 * archive nobody can review is not installed through the marketplace.
 */
export function readModuleArchive(archive: Uint8Array): ModuleArchiveContents {
  const headers: UnzipFileInfo[] = [];
  unzipSync(archive, {
    filter: (file) => {
      headers.push(file);
      return false;
    },
  });
  const chosen = chooseManifest(headers);
  if (chosen === null) {
    throw new Error("Module archive contains no manifest");
  }
  const manifestName = chosen.header.name;
  if (!manifestName.toLowerCase().endsWith(".json")) {
    throw new Error(`Module archive manifest ${manifestName} is not JSON, so it cannot be reviewed`);
  }
  if (chosen.header.originalSize > MAX_MANIFEST_BYTES) {
    throw new Error(`Module archive manifest is ${chosen.header.originalSize} bytes, over ${MAX_MANIFEST_BYTES}`);
  }
  const entries = unzipSync(archive, { filter: (file) => file.name === manifestName });
  const raw = entries[manifestName];
  if (!raw) {
    throw new Error(`Module archive ${manifestName} could not be read`);
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(strFromU8(raw));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Module archive ${manifestName} is not valid JSON: ${reason}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`Module archive ${manifestName} is not a JSON object`);
  }

  const files: ModuleFileEntry[] = [];
  for (const header of headers) {
    const path = modulePath(chosen.root, header.name);
    if (path !== null) {
      files.push({ path, size: header.originalSize });
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { manifest: manifest as Record<string, unknown>, files };
}

/**
 * The permission ids a manifest declares, in order and without duplicates.
 * A missing or malformed `permissions` declares nothing, as barkloader reads it.
 */
export function manifestPermissions(manifest: Record<string, unknown>): string[] {
  const raw = manifest.permissions;
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry === "string" && entry.length > 0) {
      seen.add(entry);
    }
  }
  return Array.from(seen);
}

/** A `local[]` endpoint as an install review shows it. */
export interface LocalEndpointSummary {
  id: string;
  name: string;
  protocol: string;
}

/**
 * Every `local[]` entry that names an id. Deliberately not filtered down to
 * the entries barkloader's `validate_local` accepts: barkloader refuses the
 * whole install over an invalid entry, so counting one here can only ask for
 * an approval that the install would not have needed, never skip one it did.
 */
export function manifestLocalEndpoints(manifest: Record<string, unknown>): LocalEndpointSummary[] {
  if (!Array.isArray(manifest.local)) {
    return [];
  }
  const endpoints: LocalEndpointSummary[] = [];
  const seen = new Set<string>();
  for (const entry of manifest.local) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== "string" || raw.id === "" || seen.has(raw.id)) {
      continue;
    }
    seen.add(raw.id);
    endpoints.push({
      id: raw.id,
      name: typeof raw.name === "string" ? raw.name.trim() : raw.id,
      protocol: typeof raw.protocol === "string" ? raw.protocol : "",
    });
  }
  return endpoints;
}

/** What a manifest declares that an install approval does not cover. */
export interface ApprovalShortfall {
  unapproved: string[];
  unapprovedLocalEndpoints: string[];
}

/**
 * The permissions and `local[]` endpoints a manifest declares beyond what
 * was approved, or null when the approval covers everything. Every install
 * that takes an approval refuses an archive this does not answer null for.
 */
export function approvalShortfall(
  manifest: Record<string, unknown>,
  approval: { approvedPermissions: readonly string[]; approvedLocalEndpoints: readonly string[] }
): ApprovalShortfall | null {
  const unapproved = unapprovedIds(manifestPermissions(manifest), approval.approvedPermissions);
  const unapprovedLocalEndpoints = unapprovedIds(
    manifestLocalEndpoints(manifest).map((endpoint) => endpoint.id),
    approval.approvedLocalEndpoints
  );
  if (unapproved.length === 0 && unapprovedLocalEndpoints.length === 0) {
    return null;
  }
  return { unapproved, unapprovedLocalEndpoints };
}

/** The ids in `requested` that `approved` does not contain, in `requested` order. */
export function unapprovedIds(requested: readonly string[], approved: readonly string[]): string[] {
  const approvedSet = new Set(approved);
  return requested.filter((id) => !approvedSet.has(id));
}
