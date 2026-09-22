//! The bundled woofx3 module's goal functions.

use crate::runtime::resource_function_harness::Harness;
use serde_json::{Value, json};

const GOAL_JS: &str = include_str!("../../../../modules/woofx3/functions/goal.js");
const TARGET: &str = "woofx3:goal:bits";

fn goal(settings: Value) -> Harness {
    Harness::new(GOAL_JS, TARGET, "goal", settings)
}

fn add(harness: &Harness, amount: Value) -> Value {
    harness
        .run("goalAdd", json!({ "target": TARGET, "amount": amount }))
        .unwrap()
}

/// The single `goal.reached` the last run asked to publish, or None.
fn reached(harness: &Harness) -> Option<Value> {
    let events = harness.take_events();
    assert!(events.len() <= 1, "at most one event per change: {events:?}");
    events
        .into_iter()
        .next()
        .map(|(event_type, data)| {
            assert_eq!(event_type, "goal.reached");
            data
        })
}

#[test]
fn a_goal_with_no_value_starts_from_its_initial_value() {
    let harness = goal(json!({ "goal": 100, "initialValue": 10 }));
    let result = add(&harness, json!(5));
    assert_eq!(result["previous"], 10);
    assert_eq!(result["next"], 15);
    assert_eq!(result["goal"], 100);
    assert_eq!(harness.stored(), Some(json!({ "value": 15, "firstReachedAt": null })));
}

#[test]
fn add_and_subtract_move_by_the_amount_given() {
    let harness = goal(json!({ "goal": 100 }));
    add(&harness, json!(40));
    let result = harness
        .run("goalSubtract", json!({ "target": TARGET, "amount": 15 }))
        .unwrap();
    assert_eq!(result["previous"], 40);
    assert_eq!(result["next"], 25);
}

// Add and Subtract with no amount fall back to the goal's step, which is what
// a chat command counting one at a time relies on.
#[test]
fn add_with_no_amount_moves_by_the_goal_step() {
    let harness = goal(json!({ "goal": 100, "step": 7 }));
    assert_eq!(harness.run("goalAdd", json!({ "target": TARGET })).unwrap()["next"], 7);
    let subtracted = harness
        .run("goalSubtract", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(subtracted["next"], 0);
}

// A workflow forwarding `${trigger.data.amount}` hands the amount over as a
// string, so a cheer must add rather than append.
#[test]
fn an_amount_that_arrives_as_a_string_is_added_as_a_number() {
    let harness = goal(json!({ "goal": 1000 }));
    add(&harness, json!("250"));
    let result = add(&harness, json!("250"));
    assert_eq!(result["next"], 500);
}

#[test]
fn add_refuses_an_amount_that_is_not_a_number() {
    let harness = goal(json!({ "goal": 100 }));
    let err = harness
        .run("goalAdd", json!({ "target": TARGET, "amount": "lots" }))
        .unwrap_err();
    assert!(err.contains("not a number"), "{err}");
    assert_eq!(harness.stored(), None);
}

#[test]
fn set_refuses_a_value_that_is_not_a_number() {
    let harness = goal(json!({ "goal": 100 }));
    let err = harness
        .run("goalSet", json!({ "target": TARGET, "value": "lots" }))
        .unwrap_err();
    assert!(err.contains("not a number"), "{err}");
    assert_eq!(harness.stored(), None);
}

// Reaching the goal is an edge: the change that carries the value across the
// target announces, and the ones that climb further past it do not.
#[test]
fn reaching_the_goal_announces_it_once() {
    let harness = goal(json!({ "goal": 100 }));
    add(&harness, json!(60));
    assert_eq!(reached(&harness), None);

    add(&harness, json!(40));
    let event = reached(&harness).expect("crossing the goal announces it");
    assert_eq!(event["target"], TARGET);
    assert_eq!(event["previous"], 60);
    assert_eq!(event["next"], 100);
    assert_eq!(event["goal"], 100);
    assert_eq!(event["first"], true);
    assert!(event["firstReachedAt"].as_f64().unwrap() > 0.0);

    add(&harness, json!(500));
    assert_eq!(reached(&harness), None, "climbing past the goal announces nothing");
}

#[test]
fn setting_a_goal_past_its_target_announces_it() {
    let harness = goal(json!({ "goal": 100 }));
    harness
        .run("goalSet", json!({ "target": TARGET, "value": 250 }))
        .unwrap();
    let event = reached(&harness).expect("a set that crosses the goal announces it");
    assert_eq!(event["previous"], 0);
    assert_eq!(event["next"], 250);
}

// The moment of the first crossing is kept, so a later change cannot rewrite
// when the goal was met.
#[test]
fn the_first_time_the_goal_was_reached_is_remembered() {
    let harness = goal(json!({ "goal": 10 }));
    add(&harness, json!(10));
    let first_at = reached(&harness).unwrap()["firstReachedAt"].clone();

    let later = add(&harness, json!(5));
    assert_eq!(later["firstReachedAt"], first_at);
    assert_eq!(harness.stored().unwrap()["firstReachedAt"], first_at);
}

// Off by default: correcting a goal downward and passing the target again is
// usually a correction, not a second reason to celebrate.
#[test]
fn reaching_the_goal_again_announces_nothing_by_default() {
    let harness = goal(json!({ "goal": 10 }));
    add(&harness, json!(10));
    reached(&harness).expect("first crossing announces");

    harness
        .run("goalSubtract", json!({ "target": TARGET, "amount": 6 }))
        .unwrap();
    assert_eq!(reached(&harness), None);

    add(&harness, json!(6));
    assert_eq!(reached(&harness), None, "re-crossing is silent unless asked for");
}

#[test]
fn a_goal_set_to_announce_every_time_announces_each_crossing() {
    let harness = goal(json!({ "goal": 10, "announceEveryTime": true }));
    add(&harness, json!(10));
    let first = reached(&harness).expect("first crossing announces");
    assert_eq!(first["first"], true);
    let first_at = first["firstReachedAt"].clone();

    harness
        .run("goalSubtract", json!({ "target": TARGET, "amount": 6 }))
        .unwrap();
    assert_eq!(reached(&harness), None);

    add(&harness, json!(6));
    let again = reached(&harness).expect("re-crossing announces");
    assert_eq!(again["first"], false);
    assert_eq!(
        again["firstReachedAt"], first_at,
        "the first crossing is still the one that is remembered"
    );
}

// Starting the goal over is what lets it be reached for the first time again.
#[test]
fn reset_forgets_that_the_goal_was_ever_reached() {
    let harness = goal(json!({ "goal": 10 }));
    add(&harness, json!(10));
    reached(&harness).expect("first crossing announces");

    let reset = harness.run("goalReset", json!({ "target": TARGET })).unwrap();
    assert_eq!(reset["next"], 0);
    assert_eq!(reset["firstReachedAt"], Value::Null);
    assert_eq!(reached(&harness), None, "a reset does not itself reach the goal");

    add(&harness, json!(10));
    assert_eq!(reached(&harness).unwrap()["first"], true);
}

// There is no crossing to announce, because the value was never below the goal.
#[test]
fn a_goal_that_starts_at_its_target_is_not_announced() {
    let harness = goal(json!({ "goal": 100, "initialValue": 100 }));
    let result = add(&harness, json!(5));
    assert_eq!(result["reached"], false);
    assert_eq!(reached(&harness), None);
}

// The lifetime setting is what decides whether the engine clears the value
// when the stream session ends.
#[test]
fn a_session_goal_is_written_to_be_cleared_when_the_session_ends() {
    for (lifetime, cleared) in [("session", true), ("forever", false)] {
        let harness = goal(json!({ "goal": 100, "lifetime": lifetime }));
        add(&harness, json!(1));
        let options = harness.storage.write_options.lock().unwrap();
        assert_eq!(options[0].clear_on_session_end, cleared, "lifetime {lifetime}");
    }
}

// The reason every write is a compare-and-set: a concurrent change is retried
// from, not overwritten. A goal is fed by several workflows at once, so two
// events landing together is the ordinary case rather than the rare one.
#[test]
fn an_add_that_loses_a_race_retries_from_the_winning_value() {
    let harness = goal(json!({ "goal": 100 }));
    *harness.storage.lose_next_race.lock().unwrap() =
        Some(json!({ "value": 70, "firstReachedAt": null }));
    let result = add(&harness, json!(40));
    assert_eq!(result["previous"], 70);
    assert_eq!(result["next"], 110);
    let event = reached(&harness).expect("the retried change is the one that crossed");
    assert_eq!(event["previous"], 70);
}

#[test]
fn refuses_a_target_that_is_not_a_goal() {
    let harness = Harness::new(GOAL_JS, TARGET, "counter", json!({}));
    let err = harness
        .run("goalAdd", json!({ "target": TARGET }))
        .unwrap_err();
    assert!(err.contains("not a goal"), "{err}");
}

#[test]
fn refuses_a_goal_that_does_not_exist_or_was_not_chosen() {
    let harness = goal(json!({ "goal": 100 }));
    let missing = harness
        .run("goalAdd", json!({ "target": "woofx3:goal:gone" }))
        .unwrap_err();
    assert!(missing.contains("does not exist"), "{missing}");
    let unchosen = harness.run("goalAdd", json!({})).unwrap_err();
    assert!(unchosen.contains("no goal chosen"), "{unchosen}");
}
