//! The bundled woofx3 module's schedule functions.
//!
//! A running schedule is stored as its next run, so these tests seed and read
//! `nextAt` against the wall clock the sandbox's `Date.now()` also reads, and
//! allow for the time a test takes to run.
//!
//! An epoch in milliseconds is past `i32`, and the sandbox hands any number
//! that is not an `i32` back as a float, so a seeded `nextAt` is a float too:
//! compare-and-set compares encodings, and `1.0` is not `1`.

use crate::runtime::resource_function_harness::Harness;
use serde_json::{Value, json};
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEDULE_JS: &str = include_str!("../../../../modules/woofx3/functions/schedule.js");
const TARGET: &str = "woofx3:schedule:chat_plug";
const MINUTE_MS: i64 = 60_000;
const FIFTEEN_MINUTES_MS: i64 = 15 * MINUTE_MS;
const CANCELLED: &str = "cancel woofx3/schedule_due/woofx3:schedule:chat_plug";

/// Far more than any of these tests take, far less than the intervals in them.
const SLACK_MS: i64 = 5_000;

fn schedule(settings: Value) -> Harness {
    Harness::new(SCHEDULE_JS, TARGET, "schedule", settings)
}

fn set_stream(harness: &Harness, state: Result<bool, String>) {
    *harness.stream.0.lock().unwrap() = state;
}

/// A schedule on a stream that is live, so being offline is not why it skips.
fn live_schedule(settings: Value) -> Harness {
    let harness = schedule(settings);
    set_stream(&harness, Ok(true));
    harness
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// A running 15-minute schedule, stored as the sandbox would store one whose
/// next run is `offset_ms` from now.
fn running_in(offset_ms: i64) -> Value {
    json!({
        "running": true,
        "nextAt": (now_ms() + offset_ms) as f64,
        "intervalMs": FIFTEEN_MINUTES_MS,
        "lastFiredAt": null,
    })
}

fn next_at(value: &Value) -> i64 {
    value["nextAt"]
        .as_f64()
        .expect("a running schedule has nextAt") as i64
}

fn assert_next_run_in(value: &Value, expected_ms: i64) {
    let left = next_at(value) - now_ms();
    assert!(
        left <= expected_ms && left > expected_ms - SLACK_MS,
        "next run in {left}ms, want about {expected_ms}ms"
    );
}

fn armed_at(when_ms: i64) -> String {
    format!("at woofx3/schedule_due/{TARGET}@{when_ms}")
}

#[test]
fn starting_arms_the_first_run_one_interval_out() {
    let harness = schedule(json!({ "interval": 15 }));
    let result = harness
        .run("scheduleStart", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["running"], true);
    assert_next_run_in(&result, FIFTEEN_MINUTES_MS);

    let stored = harness.stored().unwrap();
    assert_eq!(stored["running"], true);
    assert_eq!(stored["nextAt"], result["nextAt"]);
    assert_eq!(harness.take_schedule_calls(), [armed_at(next_at(&result))]);
    assert_eq!(harness.take_events(), []);
}

#[test]
fn starting_a_running_schedule_keeps_its_place() {
    let harness = schedule(json!({ "interval": 15 }));
    let stored = running_in(MINUTE_MS);
    harness.store(stored.clone());
    let result = harness
        .run("scheduleStart", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["nextAt"], stored["nextAt"]);
}

#[test]
fn stopping_cancels_the_next_run_and_a_new_schedule_reads_stopped() {
    let harness = schedule(json!({}));
    let read = harness
        .run("scheduleGet", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(read["running"], false);
    assert_eq!(read["nextAt"], Value::Null);

    harness.store(running_in(MINUTE_MS));
    let result = harness
        .run("scheduleStop", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["running"], false);
    assert_eq!(harness.take_schedule_calls(), [CANCELLED]);
}

#[test]
fn a_due_firing_announces_the_run_and_arms_the_next_on_its_grid() {
    let harness = live_schedule(json!({ "interval": 15 }));
    let stored = running_in(-1_000);
    harness.store(stored.clone());

    let result = harness
        .run("scheduleFire", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["fired"], true);

    let events = harness.take_events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].0, "schedule.fired");
    assert_eq!(events[0].1["target"], TARGET);

    let next = harness.stored().unwrap();
    assert_eq!(next_at(&next), next_at(&stored) + FIFTEEN_MINUTES_MS);
    assert!(next["lastFiredAt"].as_f64().is_some());
    assert_eq!(harness.take_schedule_calls(), [armed_at(next_at(&next))]);
}

#[test]
fn a_repeated_firing_announces_nothing_and_arms_again() {
    let harness = live_schedule(json!({ "interval": 15 }));
    harness.store(running_in(-1_000));
    harness
        .run("scheduleFire", json!({ "target": TARGET }))
        .unwrap();
    harness.take_events();
    harness.take_schedule_calls();

    let result = harness
        .run("scheduleFire", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["fired"], false);
    assert_eq!(harness.take_events(), []);
    let next = harness.stored().unwrap();
    assert_eq!(harness.take_schedule_calls(), [armed_at(next_at(&next))]);
}

#[test]
fn a_firing_that_loses_a_race_announces_nothing() {
    let harness = schedule(json!({ "interval": 15 }));
    harness.store(running_in(-1_000));
    *harness.storage.lose_next_race.lock().unwrap() = Some(json!({ "running": false }));
    let result = harness
        .run("scheduleFire", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["fired"], false);
    assert_eq!(harness.take_events(), []);
    assert_eq!(harness.take_schedule_calls(), Vec::<String>::new());
}

#[test]
fn a_run_missed_by_more_than_an_interval_is_skipped_and_stays_on_the_grid() {
    let harness = schedule(json!({ "interval": 15 }));
    let stored = running_in(-(8 * 60 * MINUTE_MS));
    harness.store(stored.clone());

    let result = harness
        .run("scheduleFire", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["fired"], false);
    assert_eq!(harness.take_events(), []);

    let next = harness.stored().unwrap();
    assert_eq!(next["lastFiredAt"], Value::Null);
    let left = next_at(&next) - now_ms();
    assert!(
        left > 0 && left <= FIFTEEN_MINUTES_MS,
        "next run in {left}ms"
    );
    assert_eq!((next_at(&next) - next_at(&stored)) % FIFTEEN_MINUTES_MS, 0);
}

#[test]
fn an_offline_firing_is_skipped_by_default_and_keeps_the_grid() {
    let harness = schedule(json!({ "interval": 15 }));
    let stored = running_in(-1_000);
    harness.store(stored.clone());

    let result = harness
        .run("scheduleFire", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["fired"], false);
    assert_eq!(harness.take_events(), []);

    let next = harness.stored().unwrap();
    assert_eq!(next["lastFiredAt"], Value::Null);
    assert_eq!(next_at(&next), next_at(&stored) + FIFTEEN_MINUTES_MS);
    assert_eq!(harness.take_schedule_calls(), [armed_at(next_at(&next))]);
}

#[test]
fn a_schedule_set_to_run_while_offline_fires_on_an_offline_stream() {
    let harness = schedule(json!({ "interval": 15, "runWhileOffline": true }));
    harness.store(running_in(-1_000));
    let result = harness
        .run("scheduleFire", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["fired"], true);
    assert_eq!(harness.take_events().len(), 1);
}

#[test]
fn a_schedule_set_to_run_while_offline_never_asks_whether_the_stream_is_live() {
    let harness = schedule(json!({ "interval": 15, "runWhileOffline": true }));
    set_stream(&harness, Err("db proxy down".into()));
    harness.store(running_in(-1_000));
    let result = harness
        .run("scheduleFire", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["fired"], true);
}

#[test]
fn an_unknown_stream_state_writes_nothing_so_the_run_can_be_retried() {
    let harness = schedule(json!({ "interval": 15 }));
    set_stream(&harness, Err("db proxy down".into()));
    let stored = running_in(-1_000);
    harness.store(stored.clone());

    let err = harness
        .run("scheduleFire", json!({ "target": TARGET }))
        .unwrap_err();
    assert!(err.contains("db proxy down"), "{err}");
    assert_eq!(harness.stored(), Some(stored));
    assert_eq!(harness.take_events(), []);
}

#[test]
fn firings_for_a_stopped_or_deleted_schedule_do_nothing() {
    let harness = schedule(json!({}));
    harness.store(json!({ "running": false, "lastFiredAt": null }));
    let stopped = harness
        .run("scheduleFire", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(stopped["fired"], false);

    let deleted = harness
        .run("scheduleFire", json!({ "target": "woofx3:schedule:gone" }))
        .unwrap();
    assert_eq!(deleted["fired"], false);
    assert_eq!(harness.take_events(), []);
    assert_eq!(harness.take_schedule_calls(), Vec::<String>::new());
}

#[test]
fn reconcile_arms_running_schedules_in_place_even_when_overdue() {
    let harness = schedule(json!({ "interval": 15 }));
    let stored = running_in(-1_000);
    harness.store(stored.clone());
    let result = harness.run("scheduleReconcile", json!({})).unwrap();
    assert_eq!(result["armed"], 1);
    assert_eq!(harness.stored(), Some(stored.clone()));
    assert_eq!(harness.take_schedule_calls(), [armed_at(next_at(&stored))]);
    assert_eq!(harness.take_events(), []);
}

#[test]
fn reconcile_leaves_a_stopped_schedule_alone() {
    let harness = schedule(json!({}));
    let result = harness.run("scheduleReconcile", json!({})).unwrap();
    assert_eq!(result["armed"], 0);
    assert_eq!(harness.take_schedule_calls(), Vec::<String>::new());
}

#[test]
fn reconcile_moves_the_next_run_when_the_interval_was_edited() {
    let harness = schedule(json!({ "interval": 1 }));
    harness.store(running_in(FIFTEEN_MINUTES_MS));
    harness.run("scheduleReconcile", json!({})).unwrap();

    let stored = harness.stored().unwrap();
    assert_eq!(stored["intervalMs"], MINUTE_MS);
    assert_next_run_in(&stored, MINUTE_MS);
    assert_eq!(harness.take_schedule_calls(), [armed_at(next_at(&stored))]);
}

#[test]
fn intervals_outside_the_limits_are_held_to_them() {
    let four_weeks = 28 * 24 * 60 * MINUTE_MS;
    for (interval, expected) in [
        (json!(0), MINUTE_MS),
        (json!(-5), MINUTE_MS),
        (json!(1_000_000), four_weeks),
        (json!("not a number"), FIFTEEN_MINUTES_MS),
        (Value::Null, FIFTEEN_MINUTES_MS),
    ] {
        let harness = schedule(json!({ "interval": interval }));
        let result = harness
            .run("scheduleStart", json!({ "target": TARGET }))
            .unwrap();
        assert_next_run_in(&result, expected);
    }
}

#[test]
fn a_session_schedule_is_written_to_be_cleared_when_the_session_ends() {
    for (lifetime, cleared) in [("session", true), ("forever", false)] {
        let harness = schedule(json!({ "lifetime": lifetime }));
        harness
            .run("scheduleStart", json!({ "target": TARGET }))
            .unwrap();
        let options = harness.storage.write_options.lock().unwrap();
        assert_eq!(options[0].clear_on_session_end, cleared, "{lifetime}");
    }
}

#[test]
fn only_a_schedule_can_be_targeted() {
    let harness = Harness::new(SCHEDULE_JS, TARGET, "counter", json!({}));
    let err = harness
        .run("scheduleStart", json!({ "target": TARGET }))
        .unwrap_err();
    assert!(err.contains("not a schedule"), "{err}");

    let missing = schedule(json!({}));
    for parameters in [json!({}), json!({ "target": "woofx3:schedule:gone" })] {
        assert!(missing.run("scheduleGet", parameters).is_err());
    }
}
