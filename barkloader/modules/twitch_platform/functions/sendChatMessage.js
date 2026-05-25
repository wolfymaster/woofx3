function sendChatMessage(ctx) {
  const params = (ctx.event && ctx.event.parameters) || ctx.event || {};
  const text = (params.message) || "";
  if (!text) {
    return { sent: false, reason: "no message" };
  }
  ctx.chat.sendMessage(text);
  return { sent: true };
}
