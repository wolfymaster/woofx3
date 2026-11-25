// One webhook body per subscribed Kick event, shaped as the event examples in
// Kick's public docs (docs.kick.com, "Event types"). Tests clone before changing one.

/** `chat.message.sent` version 1. */
export const chatMessageSent = {
  message_id: "msg-0001",
  broadcaster: {
    is_anonymous: false,
    user_id: 4242,
    username: "Wolfy",
    is_verified: true,
    profile_picture: "https://files.kick.com/wolfy.png",
    channel_slug: "wolfy",
    identity: null,
  },
  sender: {
    is_anonymous: false,
    user_id: 777,
    username: "Pup_Pal",
    is_verified: false,
    profile_picture: "https://files.kick.com/pup.png",
    channel_slug: "pup-pal",
    identity: {
      username_color: "#FF5733",
      badges: [
        {
          text: "Moderator",
          type: "moderator",
        },
        {
          text: "Subscriber",
          type: "subscriber",
          count: 3,
        },
      ],
    },
  },
  content: "hello [emote:4148074:HYPERCLAP] wolfy",
  emotes: [
    {
      emote_id: "4148074",
      positions: [
        {
          s: 6,
          e: 30,
        },
      ],
    },
  ],
  created_at: "2026-11-25T10:00:00Z",
};

/** `channel.followed` version 1. */
export const channelFollowed = {
  broadcaster: {
    is_anonymous: false,
    user_id: 4242,
    username: "Wolfy",
    is_verified: true,
    profile_picture: "https://files.kick.com/wolfy.png",
    channel_slug: "wolfy",
    identity: null,
  },
  follower: {
    is_anonymous: false,
    user_id: 777,
    username: "Pup_Pal",
    is_verified: false,
    profile_picture: "",
    channel_slug: "pup-pal",
    identity: null,
  },
};

/** `channel.subscription.new` version 1. */
export const subscriptionNew = {
  broadcaster: {
    is_anonymous: false,
    user_id: 4242,
    username: "Wolfy",
    is_verified: true,
    profile_picture: "https://files.kick.com/wolfy.png",
    channel_slug: "wolfy",
    identity: null,
  },
  subscriber: {
    is_anonymous: false,
    user_id: 777,
    username: "Pup_Pal",
    is_verified: false,
    profile_picture: "",
    channel_slug: "pup-pal",
    identity: null,
  },
  duration: 1,
  created_at: "2026-11-25T10:00:00Z",
  expires_at: "2026-12-25T10:00:00Z",
};

/** `channel.subscription.renewal` version 1. */
export const subscriptionRenewal = {
  broadcaster: {
    is_anonymous: false,
    user_id: 4242,
    username: "Wolfy",
    is_verified: true,
    profile_picture: "https://files.kick.com/wolfy.png",
    channel_slug: "wolfy",
    identity: null,
  },
  subscriber: {
    is_anonymous: false,
    user_id: 777,
    username: "Pup_Pal",
    is_verified: false,
    profile_picture: "",
    channel_slug: "pup-pal",
    identity: null,
  },
  duration: 6,
  created_at: "2026-11-25T10:00:00Z",
  expires_at: "2026-12-25T10:00:00Z",
};

/** `channel.subscription.gifts` version 1. */
export const subscriptionGifts = {
  broadcaster: {
    is_anonymous: false,
    user_id: 4242,
    username: "Wolfy",
    is_verified: true,
    profile_picture: "https://files.kick.com/wolfy.png",
    channel_slug: "wolfy",
    identity: null,
  },
  gifter: {
    is_anonymous: false,
    user_id: 555,
    username: "Gifty",
    is_verified: false,
    profile_picture: "",
    channel_slug: "gifty",
    identity: null,
  },
  giftees: [
    {
      is_anonymous: false,
      user_id: 1,
      username: "One",
      is_verified: false,
      profile_picture: "",
      channel_slug: "one",
      identity: null,
    },
    {
      is_anonymous: false,
      user_id: 2,
      username: "Two",
      is_verified: false,
      profile_picture: "",
      channel_slug: "two",
      identity: null,
    },
    {
      is_anonymous: false,
      user_id: 3,
      username: "Three",
      is_verified: false,
      profile_picture: "",
      channel_slug: "three",
      identity: null,
    },
  ],
  created_at: "2026-11-25T10:00:00Z",
  expires_at: "2026-12-25T10:00:00Z",
};

/** `channel.reward.redemption.updated` version 1. */
export const redemptionUpdated = {
  id: "01REDEMPTION",
  user_input: "play the howl",
  status: "pending",
  redeemed_at: "2026-11-25T10:00:00Z",
  reward: {
    id: "01REWARD",
    title: "Hydrate",
    cost: 100,
    description: "drink water",
  },
  redeemer: {
    user_id: 777,
    username: "Pup_Pal",
    is_verified: false,
    profile_picture: "",
    channel_slug: "pup-pal",
  },
  broadcaster: {
    user_id: 4242,
    username: "Wolfy",
    is_verified: true,
    profile_picture: "",
    channel_slug: "wolfy",
  },
};

/** `livestream.status.updated` version 1. */
export const livestreamStatusUpdated = {
  broadcaster: {
    is_anonymous: false,
    user_id: 4242,
    username: "Wolfy",
    is_verified: true,
    profile_picture: "https://files.kick.com/wolfy.png",
    channel_slug: "wolfy",
    identity: null,
  },
  is_live: true,
  title: "cozy stream",
  started_at: "2026-11-25T10:00:00Z",
  ended_at: null,
};

/** `kicks.gifted` version 1. */
export const kicksGifted = {
  broadcaster: {
    user_id: 4242,
    username: "Wolfy",
    is_verified: true,
    profile_picture: "",
    channel_slug: "wolfy",
  },
  sender: {
    user_id: 777,
    username: "Pup_Pal",
    is_verified: false,
    profile_picture: "",
    channel_slug: "pup-pal",
  },
  gift: {
    amount: 100,
    name: "Full Send",
    type: "BASIC",
    tier: "BASIC",
    message: "w",
    pinned_time_seconds: 0,
  },
  created_at: "2026-11-25T10:00:00Z",
};
