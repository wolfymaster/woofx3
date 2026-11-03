import type { ChatSendPayload } from "@woofx3/api/platform-gateway";

/** The colours Twitch's Send Chat Announcement takes. */
const ANNOUNCEMENT_COLORS = ["primary", "blue", "green", "orange", "purple"] as const;

export type AnnouncementColor = (typeof ANNOUNCEMENT_COLORS)[number];

export function isAnnouncementColor(value: string): value is AnnouncementColor {
  return (ANNOUNCEMENT_COLORS as readonly string[]).includes(value);
}

export function announcementPayload(text: string, color: string): ChatSendPayload {
  if (!isAnnouncementColor(color)) {
    throw new Error(`announcement colour must be one of ${ANNOUNCEMENT_COLORS.join(", ")}`);
  }
  return { text, announcement: { color } };
}
