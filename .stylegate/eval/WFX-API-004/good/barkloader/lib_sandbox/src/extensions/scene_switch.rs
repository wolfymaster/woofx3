//! `ctx.scene.switch`: asks the connectors host to change the program
//! scene. The subject is fixed by the engine; module code names the scene.

use crate::host::{CallScope, HostError, NatsRequester};
use serde_json::json;
use std::time::Duration;
use woofx3_cloudevents::BaseEvent;

/// Answered by the connectors OBS adapter.
const COMMAND_SUBJECT: &str = "engine.obs.command";
const EVENT_SOURCE: &str = "barkloader";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

pub fn switch_scene(
    scope: &CallScope,
    nats: &dyn NatsRequester,
    scene_name: &str,
) -> Result<(), HostError> {
    if scene_name.trim().is_empty() {
        return Err(HostError::invalid_arguments("sceneName must not be empty"));
    }
    let request = BaseEvent::new(
        COMMAND_SUBJECT,
        EVENT_SOURCE,
        json!({ "command": "switchScene", "sceneName": scene_name }),
    );
    let timeout = scope.remaining().min(REQUEST_TIMEOUT);
    nats.request(COMMAND_SUBJECT, request.to_bytes()?, timeout)?;
    Ok(())
}
