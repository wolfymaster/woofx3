import {
  type ChatSendPayload,
  isTwitchAnnouncementColor,
  TWITCH_ANNOUNCEMENT_COLORS,
} from "@woofx3/api/platform-gateway";

export function announcementPayload(text: string, color: string): ChatSendPayload {
  if (!isTwitchAnnouncementColor(color)) {
    throw new Error(`announcement colour must be one of ${TWITCH_ANNOUNCEMENT_COLORS.join(", ")}`);
  }
  return { text, announcement: { color } };
}
