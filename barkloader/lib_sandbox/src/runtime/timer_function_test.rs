//! The bundled woofx3 module's timer functions.
//!
//! A running timer is stored as the moment it ends, so these tests seed and
//! read `endsAt` against the wall clock the sandbox's `Date.now()` also reads,
//! and allow for the time a test takes to run.
//!
//! An epoch in milliseconds is past `i32`, and the sandbox hands any number
//! that is not an `i32` back as a float, so a seeded `endsAt` is a float too:
//! compare-and-set compares encodings, and `1.0` is not `1`.

use crate::runtime::resource_function_harness::Harness;
use serde_json::{Value, json};
use std::time::{SystemTime, UNIX_EPOCH};

const TIMER_JS: &str = include_str!("../../../../modules/woofx3/functions/timer.js");
const TARGET: &str = "woofx3:timer:break";

/// Far more than any of these tests take, far less than the durations in them.
const SLACK_MS: i64 = 5_000;

fn timer(settings: Value) -> Harness {
    Harness::new(TIMER_JS, TARGET, "timer", settings)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// A running timer, stored as the sandbox would store one ending `offset_ms`
/// from now.
fn running_for(offset_ms: i64) -> Value {
    json!({ "running": true, "endsAt": (now_ms() + offset_ms) as f64 })
}

fn assert_ends_in(value: &Value, expected_ms: i64) {
    let ends_at = value["endsAt"]
        .as_f64()
        .expect("a running timer has endsAt") as i64;
    let left = ends_at - now_ms();
    assert!(
        left <= expected_ms && left > expected_ms - SLACK_MS,
        "ends in {left}ms, want about {expected_ms}ms"
    );
}

#[test]
fn a_timer_with_no_value_starts_from_its_full_duration() {
    let harness = timer(json!({ "duration": 90 }));
    let result = harness
        .run("timerStart", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["running"], true);
    assert_eq!(result["previous"], 90);
    assert_eq!(result["remaining"], 90);
    assert_ends_in(&result, 90_000);

    let stored = harness.stored().unwrap();
    assert_eq!(stored["running"], true);
    assert_eq!(stored["endsAt"], result["endsAt"]);
}

#[test]
fn pause_keeps_the_time_left_and_start_resumes_from_it() {
    let harness = timer(json!({ "duration": 300 }));
    harness.store(running_for(60_000));

    let paused = harness
        .run("timerPause", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(paused["running"], false);
    assert_eq!(paused["endsAt"], Value::Null);
    assert_eq!(paused["remaining"], 60);
    let remaining_ms = harness.stored().unwrap()["remainingMs"].as_i64().unwrap();
    assert!(remaining_ms <= 60_000 && remaining_ms > 60_000 - SLACK_MS);

    let resumed = harness
        .run("timerStart", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(resumed["running"], true);
    assert_ends_in(&resumed, remaining_ms);
}

#[test]
fn a_timer_that_has_run_out_starts_again_from_its_full_duration() {
    let harness = timer(json!({ "duration": 120 }));
    harness.store(running_for(-10_000));
    let result = harness
        .run("timerStart", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["previous"], 0);
    assert_eq!(result["remaining"], 120);
    assert_ends_in(&result, 120_000);
}

#[test]
fn reset_stops_the_timer_at_its_full_duration() {
    let harness = timer(json!({ "duration": 45 }));
    harness.store(running_for(5_000));
    let result = harness
        .run("timerReset", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["running"], false);
    assert_eq!(result["remaining"], 45);
    assert_eq!(
        harness.stored(),
        Some(json!({ "running": false, "remainingMs": 45_000 }))
    );
}

#[test]
fn add_changes_the_time_left_and_leaves_a_stopped_timer_stopped() {
    let harness = timer(json!({ "duration": 60 }));
    let added = harness
        .run("timerAdd", json!({ "target": TARGET, "seconds": 30 }))
        .unwrap();
    assert_eq!(added["running"], false);
    assert_eq!(added["previous"], 60);
    assert_eq!(added["remaining"], 90);

    let taken = harness
        .run("timerAdd", json!({ "target": TARGET, "seconds": -200 }))
        .unwrap();
    assert_eq!(taken["remaining"], 0, "time left never goes below zero");
}

// A subathon's timer: a sub arriving after the timer ran out puts it back to
// counting down, rather than leaving it stuck at zero.
#[test]
fn adding_to_a_running_timer_that_has_run_out_counts_down_again() {
    let harness = timer(json!({ "duration": 60 }));
    harness.store(running_for(-1_000));
    let result = harness
        .run("timerAdd", json!({ "target": TARGET, "seconds": 30 }))
        .unwrap();
    assert_eq!(result["running"], true);
    assert_ends_in(&result, 30_000);
}

#[test]
fn set_changes_the_time_left_without_starting_or_stopping() {
    let harness = timer(json!({}));
    harness.store(running_for(5_000));
    let result = harness
        .run("timerSet", json!({ "target": TARGET, "seconds": 600 }))
        .unwrap();
    assert_eq!(result["running"], true);
    assert_ends_in(&result, 600_000);
}

#[test]
fn a_timer_cannot_be_given_more_than_a_day() {
    let harness = timer(json!({}));
    let result = harness
        .run(
            "timerSet",
            json!({ "target": TARGET, "seconds": 10_000_000 }),
        )
        .unwrap();
    assert_eq!(result["remaining"], 86_400);
}

#[test]
fn add_and_set_refuse_a_value_that_is_not_a_number() {
    let harness = timer(json!({}));
    for (entry_point, seconds) in [
        ("timerAdd", json!("lots")),
        ("timerSet", json!("")),
        ("timerSet", Value::Null),
    ] {
        let err = harness
            .run(entry_point, json!({ "target": TARGET, "seconds": seconds }))
            .unwrap_err();
        assert!(
            err.contains("not a number of seconds"),
            "{entry_point}: {err}"
        );
    }
    assert_eq!(harness.stored(), None);
}

#[test]
fn a_session_timer_is_written_to_be_cleared_when_the_session_ends() {
    for (lifetime, cleared) in [("session", true), ("forever", false)] {
        let harness = timer(json!({ "lifetime": lifetime }));
        harness
            .run("timerStart", json!({ "target": TARGET }))
            .unwrap();
        let options = harness.storage.write_options.lock().unwrap();
        assert_eq!(
            options[0].clear_on_session_end, cleared,
            "lifetime {lifetime}"
        );
    }
}

// A pause that loses a race to another writer's add must pause from the time
// that writer left, not from what it read first.
#[test]
fn a_change_that_loses_a_race_retries_from_the_winning_value() {
    let harness = timer(json!({ "duration": 60 }));
    *harness.storage.lose_next_race.lock().unwrap() =
        Some(json!({ "running": false, "remainingMs": 500_000 }));
    let result = harness
        .run("timerPause", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["previous"], 500);
    assert_eq!(
        harness.stored(),
        Some(json!({ "running": false, "remainingMs": 500_000 }))
    );
}

#[test]
fn refuses_a_target_that_is_not_a_timer() {
    let harness = Harness::new(TIMER_JS, TARGET, "counter", json!({}));
    let err = harness
        .run("timerStart", json!({ "target": TARGET }))
        .unwrap_err();
    assert!(err.contains("not a timer"), "{err}");
}

#[test]
fn refuses_a_timer_that_does_not_exist_or_was_not_chosen() {
    let harness = timer(json!({}));
    let missing = harness
        .run("timerStart", json!({ "target": "woofx3:timer:gone" }))
        .unwrap_err();
    assert!(missing.contains("does not exist"), "{missing}");
    let unchosen = harness.run("timerStart", json!({})).unwrap_err();
    assert!(unchosen.contains("no timer chosen"), "{unchosen}");
}
