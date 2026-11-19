import { manifestLocalEndpoints, manifestPermissions } from "@woofx3/api/module-manifest";
import { strFromU8, type UnzipFileInfo, unzipSync } from "fflate";

/**
 * Reading a module archive the engine has not installed yet: the manifest
 * barkloader would install from.
 *
 * The manifest is chosen by barkloader's rules, so the permissions an install
 * is approved against are the ones it installs with. Must match
 * `manifest_file_rank` in barkloader/lib_module and the junk rules in
 * barkloader/app/src/routes/archives.rs.
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
function chooseManifest(headers: readonly UnzipFileInfo[]): UnzipFileInfo | null {
  let best: { header: UnzipFileInfo; rank: number; depth: number } | null = null;
  for (const header of headers) {
    const rank = manifestRank(header.name);
    const normalized = normalizeArchivePath(header.name);
    if (rank === null || normalized === null || isJunk(normalized)) {
      continue;
    }
    const depth = normalized.split("/").length - 1;
    if (best === null || rank < best.rank || (rank === best.rank && depth < best.depth)) {
      best = { header, rank, depth };
    }
  }
  return best === null ? null : best.header;
}

/**
 * The manifest of a module archive. Throws when the archive is
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
  const manifestName = chosen.name;
  if (!manifestName.toLowerCase().endsWith(".json")) {
    throw new Error(`Module archive manifest ${manifestName} is not JSON, so it cannot be reviewed`);
  }
  if (chosen.originalSize > MAX_MANIFEST_BYTES) {
    throw new Error(`Module archive manifest is ${chosen.originalSize} bytes, over ${MAX_MANIFEST_BYTES}`);
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

  return { manifest: manifest as Record<string, unknown> };
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
