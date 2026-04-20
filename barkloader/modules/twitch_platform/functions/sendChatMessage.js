function sendChatMessage(ctx) {
  const text = (ctx.event?.message) || "";
  if (!text) {
    return { sent: false, reason: "no message" };
  }
  ctx.chat.sendMessage(text);
  return { sent: true };
}
