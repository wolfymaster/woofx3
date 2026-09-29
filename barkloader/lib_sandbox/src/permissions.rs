//! Permissions a module manifest may declare under `permissions`.
//!
//! A permission opens a privileged host function to that module's code. Most
//! of what a module can reach needs none; a permission is for an action that
//! changes the channel, acts on its chatters, or changes what the stream
//! shows. Permissions are declared by
//! the module and enforced by the engine, and shown on the module install page
//! (woofx3-ui feat/module-permissions-review). Install validation accepts only
//! the ids listed here, and a call to a function that requires one the
//! invoking module did not declare is refused before anything is sent.

/// Act on chatters: `ctx.twitch.timeout`.
pub const TWITCH_MODERATION: &str = "twitch.moderation";

/// Change the channel's title, category or tags: `ctx.twitch.updateStream`.
pub const TWITCH_CHANNEL: &str = "twitch.channel";

/// Change OBS: switch the program scene, show or hide a source, mute or
/// unmute an input (`ctx.obs.switchScene`, `setSourceVisibility`,
/// `setInputMute`). Listing OBS's names needs none.
pub const OBS_CONTROL: &str = "obs.control";

pub const KNOWN_PERMISSIONS: &[&str] = &[TWITCH_MODERATION, TWITCH_CHANNEL, OBS_CONTROL];

pub fn is_known_permission(id: &str) -> bool {
    KNOWN_PERMISSIONS.contains(&id)
}
