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

// A subathon runs for days, so a timer holds as much time as it is given.
#[test]
fn a_timer_can_hold_more_than_a_day() {
    let harness = timer(json!({}));
    let result = harness
        .run(
            "timerSet",
            json!({ "target": TARGET, "seconds": 10_000_000 }),
        )
        .unwrap();
    assert_eq!(result["remaining"], 10_000_000);
}

// The scheduler arms nothing further than 30 days out, so a timer ending
// later is armed at the edge of that and re-arms itself when it fires.
#[test]
fn a_timer_ending_beyond_the_scheduler_horizon_is_armed_within_it() {
    let harness = timer(json!({}));
    let forty_days = 40 * 24 * 60 * 60;
    let result = harness
        .run("timerSet", json!({ "target": TARGET, "seconds": forty_days }))
        .unwrap();
    assert_eq!(result["running"], false);
    harness.run("timerStart", json!({ "target": TARGET })).unwrap();
    let calls = harness.take_schedule_calls();
    let armed: i64 = calls
        .last()
        .and_then(|c| c.rsplit('@').next())
        .and_then(|at| at.parse::<f64>().ok())
        .expect("starting arms the end") as i64;
    let ahead = armed - now_ms();
    let horizon = 29 * 24 * 60 * 60 * 1000;
    assert!(
        ahead <= horizon && ahead > horizon - SLACK_MS,
        "armed {ahead}ms ahead, want the {horizon}ms edge"
    );
    assert_ends_in(&harness.stored().unwrap(), forty_days * 1000);
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

fn event_types(harness: &Harness) -> Vec<String> {
    harness
        .take_events()
        .into_iter()
        .map(|(event_type, _)| event_type)
        .collect()
}

#[test]
fn starting_and_pausing_are_announced() {
    let harness = timer(json!({ "duration": 60 }));
    harness
        .run("timerStart", json!({ "target": TARGET }))
        .unwrap();
    harness
        .run("timerStart", json!({ "target": TARGET }))
        .unwrap();
    harness
        .run("timerPause", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(event_types(&harness), ["timer.started", "timer.paused"]);
}

// Reset stops a running timer, but that is not the timer being paused.
#[test]
fn resetting_a_running_timer_announces_nothing() {
    let harness = timer(json!({ "duration": 60 }));
    harness.store(running_for(30_000));
    harness
        .run("timerReset", json!({ "target": TARGET }))
        .unwrap();
    assert!(harness.take_events().is_empty());
}

fn armed_at(value: &Value) -> String {
    let ends_at = value["endsAt"]
        .as_f64()
        .expect("a running timer has endsAt") as i64;
    format!("at woofx3/timer_end/{TARGET}@{ends_at}")
}

const CANCELLED: &str = "cancel woofx3/timer_end/woofx3:timer:break";

/// Runs the timer's `timer_end` firing, as the scheduler would.
fn fire(harness: &Harness) -> Value {
    harness
        .run("timerExpire", json!({ "target": TARGET }))
        .unwrap()
}

#[test]
fn starting_arms_the_end_of_the_timer_for_when_it_reaches_zero() {
    let harness = timer(json!({ "duration": 90 }));
    let result = harness
        .run("timerStart", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(
        harness.schedule.params.lock().unwrap().as_slice(),
        [json!({ "target": TARGET })]
    );
    assert_eq!(harness.take_schedule_calls(), [armed_at(&result)]);
}

#[test]
fn adding_or_setting_time_on_a_running_timer_moves_its_end() {
    let harness = timer(json!({ "duration": 60 }));
    harness.store(running_for(20_000));
    let added = harness
        .run("timerAdd", json!({ "target": TARGET, "seconds": 30 }))
        .unwrap();
    let set = harness
        .run("timerSet", json!({ "target": TARGET, "seconds": 600 }))
        .unwrap();
    assert_eq!(
        harness.take_schedule_calls(),
        [armed_at(&added), armed_at(&set)]
    );
}

#[test]
fn a_change_that_leaves_the_timer_stopped_cancels_its_end() {
    for (entry_point, parameters) in [
        ("timerPause", json!({ "target": TARGET })),
        ("timerReset", json!({ "target": TARGET })),
    ] {
        let harness = timer(json!({ "duration": 60 }));
        harness.store(running_for(20_000));
        harness.run(entry_point, parameters).unwrap();
        assert_eq!(harness.take_schedule_calls(), [CANCELLED], "{entry_point}");
    }

    let harness = timer(json!({ "duration": 60 }));
    for (entry_point, parameters) in [
        ("timerAdd", json!({ "target": TARGET, "seconds": 30 })),
        ("timerSet", json!({ "target": TARGET, "seconds": 5 })),
    ] {
        harness.run(entry_point, parameters).unwrap();
        assert_eq!(harness.take_schedule_calls(), [CANCELLED], "{entry_point}");
    }
}

// The deadline is a cache of the stored value, which has already been written:
// failing the action would report a timer as not started when it is running.
#[test]
fn a_refused_arm_still_starts_the_timer() {
    let harness = timer(json!({ "duration": 60 }));
    *harness.schedule.refusal.lock().unwrap() = Some("timer_end is full".into());
    let result = harness
        .run("timerStart", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["running"], true);
    assert_eq!(harness.stored().unwrap()["running"], true);
    assert_eq!(event_types(&harness), ["timer.started"]);
}

#[test]
fn expiry_ends_a_timer_that_has_run_out_and_announces_it() {
    let harness = timer(json!({ "duration": 60 }));
    harness.store(running_for(-500));
    assert_eq!(fire(&harness), json!({ "ended": 1 }));
    assert_eq!(
        harness.take_events(),
        [("timer.ended".to_string(), json!({ "target": TARGET }))]
    );
    assert_eq!(
        harness.stored(),
        Some(json!({ "running": false, "remainingMs": 0 }))
    );

    // A repeated firing finds it stopped.
    assert_eq!(fire(&harness), json!({ "ended": 0 }));
    assert!(harness.take_events().is_empty());
    assert!(harness.take_schedule_calls().is_empty());
}

#[test]
fn expiry_leaves_a_stopped_timer_or_one_with_no_value_alone() {
    for stored in [
        Some(json!({ "running": false, "remainingMs": 0 })),
        Some(json!({ "running": false, "remainingMs": 30_000 })),
        None,
    ] {
        let harness = timer(json!({}));
        if let Some(value) = &stored {
            harness.store(value.clone());
        }
        fire(&harness);
        assert!(harness.take_events().is_empty(), "{stored:?}");
        assert_eq!(harness.stored(), stored);
        assert!(harness.take_schedule_calls().is_empty(), "{stored:?}");
    }
}

// Time was added after the entry was armed, or the firing came early: the
// timer keeps running and its end is armed again for the stored endsAt.
#[test]
fn a_firing_before_the_timer_runs_out_arms_its_end_again() {
    let harness = timer(json!({}));
    let stored = running_for(30_000);
    harness.store(stored.clone());
    assert_eq!(fire(&harness), json!({ "ended": 0 }));
    assert!(harness.take_events().is_empty());
    assert_eq!(harness.stored(), Some(stored.clone()));
    assert_eq!(harness.take_schedule_calls(), [armed_at(&stored)]);
}

// A timer deleted after its end was armed: the firing has nothing to end.
#[test]
fn a_firing_for_a_timer_that_no_longer_exists_does_nothing() {
    let harness = timer(json!({}));
    let result = harness
        .run("timerExpire", json!({ "target": "woofx3:timer:gone" }))
        .unwrap();
    assert_eq!(result, json!({ "ended": 0 }));
    assert!(harness.take_events().is_empty());
}

#[test]
fn a_firing_without_a_target_is_refused() {
    let harness = timer(json!({}));
    let err = harness.run("timerExpire", json!({})).unwrap_err();
    assert!(err.contains("no target"), "{err}");
}

// Time added between the firing's read and its write: the add wins, and the
// timer that still has time is not announced as ended.
#[test]
fn an_add_racing_the_firing_is_never_announced_as_ended() {
    let harness = timer(json!({ "duration": 60 }));
    harness.store(running_for(-500));
    let added = running_for(30_000);
    *harness.storage.lose_next_race.lock().unwrap() = Some(added.clone());
    assert_eq!(fire(&harness), json!({ "ended": 0 }));
    assert!(harness.take_events().is_empty());
    assert_eq!(harness.stored(), Some(added));
}

// The other order: the add lands first and arms the new end, and the firing
// armed for the old end finds time left.
#[test]
fn a_firing_after_an_add_rescued_the_timer_leaves_it_running() {
    let harness = timer(json!({ "duration": 60 }));
    harness.store(running_for(-500));
    let added = harness
        .run("timerAdd", json!({ "target": TARGET, "seconds": 30 }))
        .unwrap();
    assert_eq!(added["running"], true);
    assert_eq!(event_types(&harness), ["timer.started"]);
    harness.take_schedule_calls();

    assert_eq!(fire(&harness), json!({ "ended": 0 }));
    assert!(harness.take_events().is_empty());
    assert_eq!(harness.stored().unwrap()["running"], true);
    assert_eq!(harness.take_schedule_calls(), [armed_at(&added)]);
}

// Restart after a timer ran out while the engine was down: the load-time
// reconcile ends it and announces it once.
#[test]
fn reconcile_ends_a_timer_that_ran_out_while_nothing_was_watching_once() {
    let harness = timer(json!({ "duration": 60 }));
    harness.store(running_for(-60_000));
    let result = harness.run("timerReconcile", json!({})).unwrap();
    assert_eq!(result, json!({ "ended": 1, "armed": 0 }));
    assert_eq!(
        harness.take_events(),
        [("timer.ended".to_string(), json!({ "target": TARGET }))]
    );
    assert_eq!(
        harness.stored(),
        Some(json!({ "running": false, "remainingMs": 0 }))
    );

    let again = harness.run("timerReconcile", json!({})).unwrap();
    assert_eq!(again, json!({ "ended": 0, "armed": 0 }));
    fire(&harness);
    assert!(harness.take_events().is_empty());
    assert!(harness.take_schedule_calls().is_empty());
}

// Restart with a running timer: its end, lost with the in-memory schedule, is
// armed again.
#[test]
fn reconcile_arms_the_end_of_a_running_timer() {
    let harness = timer(json!({ "duration": 60 }));
    let stored = running_for(45_000);
    harness.store(stored.clone());
    let result = harness.run("timerReconcile", json!({})).unwrap();
    assert_eq!(result, json!({ "ended": 0, "armed": 1 }));
    assert!(harness.take_events().is_empty());
    assert_eq!(harness.stored(), Some(stored.clone()));
    assert_eq!(harness.take_schedule_calls(), [armed_at(&stored)]);
}

#[test]
fn reconcile_leaves_a_stopped_timer_alone() {
    let harness = timer(json!({}));
    harness.store(json!({ "running": false, "remainingMs": 10_000 }));
    let result = harness.run("timerReconcile", json!({})).unwrap();
    assert_eq!(result, json!({ "ended": 0, "armed": 0 }));
    assert!(harness.take_schedule_calls().is_empty());
}

// A timer that was never armed (its arm refused) still ends, on the next
// reconcile after it runs out.
#[test]
fn reconcile_ends_a_timer_whose_end_was_never_armed() {
    let harness = timer(json!({ "duration": 60 }));
    *harness.schedule.refusal.lock().unwrap() = Some("timer_end is full".into());
    harness.store(running_for(-1_000));
    let result = harness.run("timerReconcile", json!({})).unwrap();
    assert_eq!(result, json!({ "ended": 1, "armed": 0 }));
    assert_eq!(event_types(&harness), ["timer.ended"]);
}

// The reconcile task belongs to this module and touches only its timers.
#[test]
fn reconcile_leaves_another_modules_timers_alone() {
    let harness = Harness::new(TIMER_JS, "other:timer:break", "timer", json!({}));
    harness.store(running_for(-500));
    let result = harness.run("timerReconcile", json!({})).unwrap();
    assert_eq!(result, json!({ "ended": 0, "armed": 0 }));
    assert!(harness.take_events().is_empty());
    assert!(harness.take_schedule_calls().is_empty());
}

// A repeating timer: its ended workflow starts it again, from the full duration.
#[test]
fn starting_an_ended_timer_runs_it_again_from_its_full_duration() {
    let harness = timer(json!({ "duration": 90 }));
    harness.store(json!({ "running": false, "remainingMs": 0 }));
    let result = harness
        .run("timerStart", json!({ "target": TARGET }))
        .unwrap();
    assert_ends_in(&result, 90_000);
    assert_eq!(event_types(&harness), ["timer.started"]);
}

#[test]
fn get_reads_a_timer_without_changing_it() {
    let harness = timer(json!({ "duration": 90 }));
    let fresh = harness.run("timerGet", json!({ "target": TARGET })).unwrap();
    assert_eq!(fresh["running"], false);
    assert_eq!(fresh["remaining"], 90);
    assert_eq!(fresh["endsAt"], Value::Null);
    assert!(harness.stored().is_none(), "reading wrote a value");

    harness.store(running_for(60_000));
    let running = harness.run("timerGet", json!({ "target": TARGET })).unwrap();
    assert_eq!(running["running"], true);
    assert!(running["remaining"].as_i64().unwrap() <= 60);
    assert_eq!(running["endsAt"], harness.stored().unwrap()["endsAt"]);
    assert!(event_types(&harness).is_empty());
    assert!(harness.take_schedule_calls().is_empty());
}
