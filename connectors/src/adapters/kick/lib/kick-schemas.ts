import { z } from "zod";

/**
 * Wire shapes of api.kick.com, from the public OpenAPI document
 * (`https://api.kick.com/swagger/doc.json`). Every response is an envelope
 * `{ data, message }`. User, broadcaster and category ids are integers on the
 * wire; woofx3 carries user ids as strings, converted once here.
 */

const KickId = z.number().int().nonnegative();

/** `{ data, message }`; errors use the same envelope or `{ message }` alone. */
export const KickEnvelopeSchema = z.object({ data: z.unknown(), message: z.string().optional() });

export const KickErrorBodySchema = z.object({ message: z.string().optional(), data: z.unknown().optional() });

export const KickUserWireSchema = z.object({
  user_id: KickId,
  name: z.string(),
  profile_picture: z.string().nullish(),
});

export const KickChannelWireSchema = z.object({
  broadcaster_user_id: KickId,
  slug: z.string(),
  channel_description: z.string().nullish(),
  stream_title: z.string().nullish(),
  category: z.object({ id: KickId, name: z.string() }).nullish(),
  stream: z
    .object({
      is_live: z.boolean(),
      start_time: z.string().nullish(),
      viewer_count: z.number().int().nonnegative().nullish(),
      language: z.string().nullish(),
      custom_tags: z.array(z.string()).nullish(),
    })
    .nullish(),
});

export const KickCategoryWireSchema = z.object({ id: KickId, name: z.string() });

export const KickRewardWireSchema = z.object({
  id: z.string(),
  title: z.string(),
  cost: z.number().int(),
  description: z.string().nullish(),
  is_enabled: z.boolean().nullish(),
});

export const KickSentChatWireSchema = z.object({ is_sent: z.boolean(), message_id: z.string() });

export const KickSubscriptionWireSchema = z.object({
  id: z.string(),
  event: z.string(),
  version: z.number().int(),
  created_at: z.string(),
});

export const KickSubscribeOutcomeWireSchema = z.object({
  name: z.string(),
  version: z.number().int(),
  subscription_id: z.string().nullish(),
  error: z.string().nullish(),
});

export const KickPublicKeyWireSchema = z.object({ public_key: z.string().min(1) });
