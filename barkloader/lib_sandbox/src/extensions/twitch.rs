//! `ctx.twitch`: the Twitch adapter's `twitchapi` commands, served by the
//! platform api extension.

use super::platform_api::PlatformApiSpec;
use crate::permissions::{TWITCH_CHANNEL, TWITCH_MODERATION};

/// Clips, shoutouts and markers are visible and harmless, and looking a user
/// up reads only what Twitch shows anyone, so any module may use them. Timing
/// a chatter out and changing the channel's title, category or tags need a
/// permission the module declares and the engine enforces; the module install
/// page shows them. Moderator changes are not reachable from modules at all.
pub const TWITCH_SPEC: PlatformApiSpec = PlatformApiSpec {
    namespace: "twitch",
    subject: "twitchapi",
    display_name: "Twitch",
    commands: &[
        ("clip", None),
        ("shoutout", None),
        ("createMarker", None),
        ("getUser", None),
        ("timeout", Some(TWITCH_MODERATION)),
        ("updateStream", Some(TWITCH_CHANNEL)),
    ],
    // The Twitch adapter answers any method of its client, writes included
    // (a shoutout, adding a moderator), so forms get only the reward picker's read.
    field_source_commands: &["listChannelPointRewards"],
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modules_reach_these_twitch_commands_with_these_permissions() {
        assert_eq!(
            TWITCH_SPEC.commands,
            &[
                ("clip", None),
                ("shoutout", None),
                ("createMarker", None),
                ("getUser", None),
                ("timeout", Some(TWITCH_MODERATION)),
                ("updateStream", Some(TWITCH_CHANNEL)),
            ]
        );
        assert_eq!(TWITCH_SPEC.error_reply_type(), "twitchapi.error");
    }
}
