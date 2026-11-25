//! `ctx.kick`: the Kick adapter's `kickapi` commands, served by the platform
//! api extension.

use super::platform_api::PlatformApiSpec;
use crate::permissions::{KICK_CHANNEL, KICK_MODERATION};

/// Looking a user up and listing the channel's rewards read only what Kick
/// shows anyone or the streamer's own picker, so any module may use them.
/// Timing a chatter out and changing the channel's title, category or tags
/// need a permission the module declares and the engine enforces.
pub const KICK_SPEC: PlatformApiSpec = PlatformApiSpec {
    namespace: "kick",
    subject: "kickapi",
    display_name: "Kick",
    commands: &[
        ("getUser", None),
        ("listRewards", None),
        ("updateStream", Some(KICK_CHANNEL)),
        ("timeout", Some(KICK_MODERATION)),
    ],
    // The reward picker of the Kick module's redemption trigger.
    field_source_commands: &["listRewards"],
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modules_reach_these_kick_commands_with_these_permissions() {
        assert_eq!(
            KICK_SPEC.commands,
            &[
                ("getUser", None),
                ("listRewards", None),
                ("updateStream", Some(KICK_CHANNEL)),
                ("timeout", Some(KICK_MODERATION)),
            ]
        );
        assert_eq!(KICK_SPEC.error_reply_type(), "kickapi.error");
    }
}
