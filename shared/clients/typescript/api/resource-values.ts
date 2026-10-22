/**
 * Where a resource instance's value lives: the owning module's storage, under
 * `state:<canonicalId>`. Every resource kind keeps its value under that key,
 * the engine reads it there for `getResourceValues`, and sceneManager serves
 * it to widgets from there. A `module.storage.changed` webhook under this key
 * is therefore a change to that instance's value; a change under any other
 * key is the module's own data.
 *
 * Barkloader's resource function harness writes the same key in Rust
 * (barkloader/lib_sandbox/src/runtime/resource_function_harness.rs).
 */
export const RESOURCE_VALUE_KEY_PREFIX = "state:";

/** The storage key that holds `canonicalId`'s value. */
export function resourceValueStorageKey(canonicalId: string): string {
  if (canonicalId === "") {
    throw new Error("resourceValueStorageKey: canonicalId must not be empty");
  }
  return `${RESOURCE_VALUE_KEY_PREFIX}${canonicalId}`;
}

/** The canonical id whose value `key` holds, or null for a key that holds no resource value. */
export function canonicalIdForStorageKey(key: string): string | null {
  if (!key.startsWith(RESOURCE_VALUE_KEY_PREFIX)) {
    return null;
  }
  const canonicalId = key.slice(RESOURCE_VALUE_KEY_PREFIX.length);
  return canonicalId === "" ? null : canonicalId;
}
