import { contentSecurityPolicy } from "@woofx3/widget-host/frame";

/**
 * Headers for a response that must never run as a document on this origin,
 * whatever it holds (a user's upload could be HTML): sandboxed with nothing
 * allowed, and its type never sniffed.
 */
export const INERT_DOCUMENT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Security-Policy": contentSecurityPolicy({ sandbox: [] }),
  "X-Content-Type-Options": "nosniff",
});
