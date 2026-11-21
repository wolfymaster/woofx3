//! Runs the shared fixtures in shared/contracts/<domain>/fixtures through the generated types (serde) and through
//! the `jsonschema` crate reading the embedded contract document. The Go and TypeScript tests run the same files,
//! so a case fixes the verdict of all three languages.

use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use woofx3_cloudevents::{
    barkloader_gen, heartbeat_gen, module_gen, outbox_gen, scene_gen, session_gen, stream_gen,
    streamstatus_gen, workflow_gen,
};

struct Case {
    name: String,
    valid: bool,
    unknown_fields: bool,
    value: Value,
}

fn fixtures(domain: &str, file: &str, schema: &str) -> Vec<Case> {
    let path = format!(
        "{}/../../../contracts/{domain}/fixtures/{file}",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let suite: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(suite["schema"], schema, "{file} is for another schema");
    suite["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| Case {
            name: c["name"].as_str().unwrap().to_string(),
            valid: c["valid"].as_bool().unwrap(),
            unknown_fields: c["unknownFields"].as_bool().unwrap_or(false),
            value: c["value"].clone(),
        })
        .collect()
}

/// Equal as JSON: a number typed as a float and one written as an integer are the same value.
fn same_json(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same_json(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| same_json(v, w)))
        }
        _ => a == b,
    }
}

fn validator(document: &str, schema: &str) -> jsonschema::Validator {
    let mut root: Value = serde_json::from_str(document).unwrap();
    root = json!({ "$ref": format!("#/components/schemas/{schema}"), "components": root["components"] });
    jsonschema::validator_for(&root).unwrap()
}

fn run<T: DeserializeOwned + Serialize>(domain: &str, file: &str, schema: &str, document: &str) {
    let validator = validator(document, schema);
    for case in fixtures(domain, file, schema) {
        let label = format!("{file}/{}", case.name);
        let typed = serde_json::from_value::<T>(case.value.clone());
        let schema_ok = validator.is_valid(&case.value);
        assert_eq!(schema_ok, case.valid, "jsonschema: {label}");
        // serde reads a null as an absent optional field, so the types alone cannot refuse one; the validator does.
        // typify reads a union discriminated by a string as an adjacently tagged enum, which refuses a field beside a
        // variant that has none, such as `error` on `{"status":"ok"}`, though an open reply allows it.
        let tolerated = (case.value.to_string().contains("null") && !case.valid)
            || (case.valid && case.unknown_fields);
        if !tolerated {
            assert_eq!(typed.is_ok(), case.valid, "typify types: {label}");
        }
        if case.valid && !case.unknown_fields {
            let encoded = serde_json::to_value(typed.unwrap()).unwrap();
            assert!(
                same_json(&encoded, &case.value),
                "round trip: {label}
 got  {encoded}
 want {}",
                case.value
            );
        }
    }
}

#[test]
fn test_scene_command_request_fixtures() {
    run::<scene_gen::SceneCommandRequest>(
        "scene",
        "scene-command-request.json",
        "SceneCommandRequest",
        scene_gen::DOCUMENT,
    );
}

#[test]
fn test_scene_command_reply_fixtures() {
    run::<scene_gen::SceneCommandReply>(
        "scene",
        "scene-command-reply.json",
        "SceneCommandReply",
        scene_gen::DOCUMENT,
    );
}

#[test]
fn test_module_field_options_request_fixtures() {
    run::<barkloader_gen::ModuleFieldOptionsRequest>(
        "barkloader",
        "module-field-options-request.json",
        "ModuleFieldOptionsRequest",
        barkloader_gen::DOCUMENT,
    );
}

#[test]
fn test_heartbeat_event_fixtures() {
    run::<heartbeat_gen::HeartbeatEvent>(
        "heartbeat",
        "heartbeat-event.json",
        "HeartbeatEvent",
        heartbeat_gen::DOCUMENT,
    );
}

#[test]
fn test_session_started_event_fixtures() {
    run::<session_gen::SessionStartedEvent>(
        "session",
        "session-started-event.json",
        "SessionStartedEvent",
        session_gen::DOCUMENT,
    );
}

#[test]
fn test_session_ended_event_fixtures() {
    run::<session_gen::SessionEndedEvent>(
        "session",
        "session-ended-event.json",
        "SessionEndedEvent",
        session_gen::DOCUMENT,
    );
}

#[test]
fn test_stream_status_observed_event_fixtures() {
    run::<streamstatus_gen::StreamStatusObservedEvent>(
        "streamstatus",
        "stream-status-observed-event.json",
        "StreamStatusObservedEvent",
        streamstatus_gen::DOCUMENT,
    );
}

#[test]
fn test_stream_status_requested_event_fixtures() {
    run::<streamstatus_gen::StreamStatusRequestedEvent>(
        "streamstatus",
        "stream-status-requested-event.json",
        "StreamStatusRequestedEvent",
        streamstatus_gen::DOCUMENT,
    );
}

#[test]
fn test_module_storage_changed_event_fixtures() {
    run::<module_gen::ModuleStorageChangedEvent>(
        "module",
        "module-storage-changed-event.json",
        "ModuleStorageChangedEvent",
        module_gen::DOCUMENT,
    );
}

#[test]
fn test_database_record_changed_event_fixtures() {
    run::<outbox_gen::DatabaseRecordChangedEvent>(
        "outbox",
        "database-record-changed-event.json",
        "DatabaseRecordChangedEvent",
        outbox_gen::DOCUMENT,
    );
}

#[test]
fn test_user_page_form_submitted_event_fixtures() {
    run::<outbox_gen::UserPageFormSubmittedEvent>(
        "outbox",
        "userpage-form-submitted-event.json",
        "UserPageFormSubmittedEvent",
        outbox_gen::DOCUMENT,
    );
}

#[test]
fn test_viewer_segment_entered_event_fixtures() {
    run::<outbox_gen::ViewerSegmentEnteredEvent>(
        "outbox",
        "viewer-segment-entered-event.json",
        "ViewerSegmentEnteredEvent",
        outbox_gen::DOCUMENT,
    );
}

#[test]
fn test_viewer_segment_left_event_fixtures() {
    run::<outbox_gen::ViewerSegmentLeftEvent>(
        "outbox",
        "viewer-segment-left-event.json",
        "ViewerSegmentLeftEvent",
        outbox_gen::DOCUMENT,
    );
}

#[test]
fn test_workflow_execute_request_fixtures() {
    run::<workflow_gen::WorkflowExecuteRequest>(
        "workflow",
        "workflow-execute-request.json",
        "WorkflowExecuteRequest",
        workflow_gen::DOCUMENT,
    );
}

#[test]
fn test_workflow_execute_reply_fixtures() {
    run::<workflow_gen::WorkflowExecuteReply>(
        "workflow",
        "workflow-execute-reply.json",
        "WorkflowExecuteReply",
        workflow_gen::DOCUMENT,
    );
}

#[test]
fn test_workflow_replay_request_fixtures() {
    run::<workflow_gen::WorkflowReplayRequest>(
        "workflow",
        "workflow-replay-request.json",
        "WorkflowReplayRequest",
        workflow_gen::DOCUMENT,
    );
}

#[test]
fn test_workflow_command_execute_request_fixtures() {
    run::<workflow_gen::WorkflowCommandExecuteRequest>(
        "workflow",
        "workflow-command-execute-request.json",
        "WorkflowCommandExecuteRequest",
        workflow_gen::DOCUMENT,
    );
}

#[test]
fn test_workflow_cancel_request_fixtures() {
    run::<workflow_gen::WorkflowCancelRequest>(
        "workflow",
        "workflow-cancel-request.json",
        "WorkflowCancelRequest",
        workflow_gen::DOCUMENT,
    );
}

#[test]
fn test_workflow_cancel_reply_fixtures() {
    run::<workflow_gen::WorkflowCancelReply>(
        "workflow",
        "workflow-cancel-reply.json",
        "WorkflowCancelReply",
        workflow_gen::DOCUMENT,
    );
}

#[test]
fn test_workflow_run_started_event_fixtures() {
    run::<workflow_gen::WorkflowRunStartedEvent>(
        "workflow",
        "workflow-run-started-event.json",
        "WorkflowRunStartedEvent",
        workflow_gen::DOCUMENT,
    );
}

#[test]
fn test_workflow_run_completed_event_fixtures() {
    run::<workflow_gen::WorkflowRunCompletedEvent>(
        "workflow",
        "workflow-run-completed-event.json",
        "WorkflowRunCompletedEvent",
        workflow_gen::DOCUMENT,
    );
}

#[test]
fn test_workflow_run_failed_event_fixtures() {
    run::<workflow_gen::WorkflowRunFailedEvent>(
        "workflow",
        "workflow-run-failed-event.json",
        "WorkflowRunFailedEvent",
        workflow_gen::DOCUMENT,
    );
}

#[test]
fn test_workflow_run_cancelled_event_fixtures() {
    run::<workflow_gen::WorkflowRunCancelledEvent>(
        "workflow",
        "workflow-run-cancelled-event.json",
        "WorkflowRunCancelledEvent",
        workflow_gen::DOCUMENT,
    );
}

#[test]
fn test_workflow_health_snapshot_event_fixtures() {
    run::<workflow_gen::WorkflowHealthSnapshotEvent>(
        "workflow",
        "workflow-health-snapshot-event.json",
        "WorkflowHealthSnapshotEvent",
        workflow_gen::DOCUMENT,
    );
}

#[test]
fn test_workflow_health_changed_event_fixtures() {
    run::<workflow_gen::WorkflowHealthChangedEvent>(
        "workflow",
        "workflow-health-changed-event.json",
        "WorkflowHealthChangedEvent",
        workflow_gen::DOCUMENT,
    );
}

#[test]
fn test_workflow_health_reply_fixtures() {
    run::<workflow_gen::WorkflowHealthReply>(
        "workflow",
        "workflow-health-reply.json",
        "WorkflowHealthReply",
        workflow_gen::DOCUMENT,
    );
}

#[test]
fn test_request_type_is_the_subject() {
    assert_eq!(
        barkloader_gen::ModuleFieldOptionsRequestType::BarkloaderModuleFieldOptions.to_string(),
        "barkloader.module.field_options"
    );
    assert_eq!(
        scene_gen::SceneCommandRequestType::EngineSceneCommand.to_string(),
        "engine.scene.command"
    );
    assert_eq!(
        heartbeat_gen::HeartbeatEventType::ComWoofx3Heartbeat.to_string(),
        "com.woofx3.heartbeat"
    );
    assert_eq!(
        session_gen::SessionStartedEventType::SessionStarted.to_string(),
        "session.started"
    );
    assert_eq!(
        session_gen::SessionEndedEventType::SessionEnded.to_string(),
        "session.ended"
    );
    assert_eq!(
        streamstatus_gen::StreamStatusObservedEventType::StreamStatusObserved.to_string(),
        "stream.status.observed"
    );
    assert_eq!(
        streamstatus_gen::StreamStatusRequestedEventType::StreamStatusRequested.to_string(),
        "stream.status.requested"
    );
}

macro_rules! stream_fixtures {
    ($($test:ident, $file:literal, $schema:ident;)*) => {$(
        #[test]
        fn $test() {
            run::<stream_gen::$schema>("stream", $file, stringify!($schema), stream_gen::DOCUMENT);
        }
    )*};
}

stream_fixtures! {
    test_user_message_event_fixtures, "user-message.json", UserMessageEvent;
    test_channel_cheer_event_fixtures, "channel-cheer.json", ChannelCheerEvent;
    test_channel_follow_event_fixtures, "channel-follow.json", ChannelFollowEvent;
    test_channel_hype_train_event_fixtures, "channel-hypetrain.json", ChannelHypeTrainEvent;
    test_channel_raid_event_fixtures, "channel-raid.json", ChannelRaidEvent;
    test_channel_points_redeem_event_fixtures, "channelpoints-redeem.json", ChannelPointsRedeemEvent;
    test_stream_online_event_fixtures, "stream-online.json", StreamOnlineEvent;
    test_stream_offline_event_fixtures, "stream-offline.json", StreamOfflineEvent;
    test_channel_subscribe_event_fixtures, "channel-subscribe.json", ChannelSubscribeEvent;
    test_channel_subscription_gift_event_fixtures, "channel-subscriptionGift.json", ChannelSubscriptionGiftEvent;
    test_channel_resub_event_fixtures, "channel-resub.json", ChannelResubEvent;
    test_channel_gift_paid_upgrade_event_fixtures, "channel-giftPaidUpgrade.json", ChannelGiftPaidUpgradeEvent;
    test_channel_prime_paid_upgrade_event_fixtures, "channel-primePaidUpgrade.json", ChannelPrimePaidUpgradeEvent;
    test_channel_unraid_event_fixtures, "channel-unraid.json", ChannelUnraidEvent;
    test_channel_pay_it_forward_event_fixtures, "channel-payItForward.json", ChannelPayItForwardEvent;
    test_channel_announcement_event_fixtures, "channel-announcement.json", ChannelAnnouncementEvent;
    test_channel_charity_donation_event_fixtures, "channel-charityDonation.json", ChannelCharityDonationEvent;
    test_channel_bits_badge_tier_event_fixtures, "channel-bitsBadgeTier.json", ChannelBitsBadgeTierEvent;
    test_channel_watch_streak_event_fixtures, "channel-watchStreak.json", ChannelWatchStreakEvent;
    test_channel_shared_subscribe_event_fixtures, "channel-sharedSubscribe.json", ChannelSharedSubscribeEvent;
    test_channel_shared_subscription_gift_event_fixtures, "channel-sharedSubscriptionGift.json", ChannelSharedSubscriptionGiftEvent;
    test_channel_shared_raid_event_fixtures, "channel-sharedRaid.json", ChannelSharedRaidEvent;
    test_channel_shared_resub_event_fixtures, "channel-sharedResub.json", ChannelSharedResubEvent;
    test_channel_shared_gift_paid_upgrade_event_fixtures, "channel-sharedGiftPaidUpgrade.json", ChannelSharedGiftPaidUpgradeEvent;
    test_channel_shared_prime_paid_upgrade_event_fixtures, "channel-sharedPrimePaidUpgrade.json", ChannelSharedPrimePaidUpgradeEvent;
    test_channel_shared_pay_it_forward_event_fixtures, "channel-sharedPayItForward.json", ChannelSharedPayItForwardEvent;
    test_channel_shared_announcement_event_fixtures, "channel-sharedAnnouncement.json", ChannelSharedAnnouncementEvent;
    test_channel_ad_break_upcoming_event_fixtures, "channel-ad-break-upcoming.json", ChannelAdBreakUpcomingEvent;
    test_channel_ad_break_begin_event_fixtures, "channel-ad-break-begin.json", ChannelAdBreakBeginEvent;
    test_channel_ad_break_end_event_fixtures, "channel-ad-break-end.json", ChannelAdBreakEndEvent;
}
