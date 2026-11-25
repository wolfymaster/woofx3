mod args;
mod in_flight;
pub mod kick;
pub mod local;
pub mod obs;
pub mod platform_api;
pub mod twitch;

pub use kick::KICK_SPEC;
pub use local::LocalExtension;
pub use obs::ObsExtension;
pub use platform_api::{PLATFORM_API_SPECS, PlatformApiExtension, PlatformApiSpec};
pub use twitch::TWITCH_SPEC;
