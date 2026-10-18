import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether the api checks that barkloader's processing callbacks carry the
 * engine secret (`WOOFX3_BARKLOADER_WEBHOOK_AUTH`). Off unless set to
 * `required`: a barkloader that predates sending it would otherwise have
 * every callback refused, so the check is turned on only once barkloader is
 * known to send it.
 */
export type BarkloaderWebhookAuth = "off" | "required";

export function parseBarkloaderWebhookAuth(value: string | undefined): BarkloaderWebhookAuth {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "" || normalized === "off") {
    return "off";
  }
  if (normalized === "required") {
    return "required";
  }
  throw new Error(`Config error: WOOFX3_BARKLOADER_WEBHOOK_AUTH is "${value}"; expected "required" or "off"`);
}

/**
 * Whether `req` carries `Authorization: Bearer <secret>`. Both sides are
 * hashed first so the comparison takes the same time whatever the presented
 * value's length, and never short-circuits.
 */
export function hasBarkloaderBearer(req: Request, secret: string): boolean {
  if (secret === "") {
    throw new Error("hasBarkloaderBearer: the engine secret must not be empty");
  }
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    return false;
  }
  const expected = createHash("sha256").update(secret).digest();
  const actual = createHash("sha256").update(match[1]!).digest();
  return timingSafeEqual(expected, actual);
}
