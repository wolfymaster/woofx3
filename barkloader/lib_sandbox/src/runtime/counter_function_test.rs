//! The bundled woofx3 module's counter functions.

use crate::runtime::resource_function_harness::Harness;
use serde_json::json;

const COUNTER_JS: &str = include_str!("../../../../modules/woofx3/functions/counter.js");
const TARGET: &str = "woofx3:counter:deaths";

fn counter(settings: serde_json::Value) -> Harness {
    Harness::new(COUNTER_JS, TARGET, "counter", settings)
}

#[test]
fn a_counter_with_no_value_starts_from_its_initial_value() {
    let harness = counter(json!({ "initialValue": 10, "step": 5 }));
    let result = harness
        .run("counterIncrement", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["previous"], 10);
    assert_eq!(result["next"], 15);
    assert_eq!(
        harness.stored(),
        Some(json!({ "value": 15, "reached": {} }))
    );
}

#[test]
fn increment_and_decrement_move_by_the_counter_step() {
    let harness = counter(json!({ "step": 2 }));
    harness
        .run("counterIncrement", json!({ "target": TARGET }))
        .unwrap();
    harness
        .run("counterIncrement", json!({ "target": TARGET }))
        .unwrap();
    let result = harness
        .run("counterDecrement", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["previous"], 4);
    assert_eq!(result["next"], 2);
}

#[test]
fn an_amount_moves_the_counter_instead_of_its_step() {
    let harness = counter(json!({ "step": 2 }));
    let up = harness
        .run(
            "counterIncrement",
            json!({ "target": TARGET, "amount": 500 }),
        )
        .unwrap();
    assert_eq!(up["next"], 500);
    let down = harness
        .run(
            "counterDecrement",
            json!({ "target": TARGET, "amount": "100" }),
        )
        .unwrap();
    assert_eq!(down["next"], 400);
}

// A step left blank in the form reaches the function as an empty string.
#[test]
fn a_blank_amount_falls_back_to_the_counter_step() {
    let harness = counter(json!({ "step": 3 }));
    let result = harness
        .run(
            "counterIncrement",
            json!({ "target": TARGET, "amount": "" }),
        )
        .unwrap();
    assert_eq!(result["next"], 3);
}

#[test]
fn refuses_an_amount_that_is_not_a_positive_number() {
    let harness = counter(json!({}));
    for amount in [json!("lots"), json!(0), json!(-5)] {
        let err = harness
            .run(
                "counterIncrement",
                json!({ "target": TARGET, "amount": amount }),
            )
            .unwrap_err();
        assert!(err.contains("cannot change"), "{amount}: {err}");
    }
    assert_eq!(harness.stored(), None);
}

#[test]
fn set_and_reset() {
    let harness = counter(json!({ "initialValue": 3 }));
    assert_eq!(
        harness
            .run("counterSet", json!({ "target": TARGET, "value": 42 }))
            .unwrap()["next"],
        42
    );
    let reset = harness
        .run("counterReset", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(reset["previous"], 42);
    assert_eq!(reset["next"], 3);
}

#[test]
fn set_refuses_a_value_that_is_not_a_number() {
    let harness = counter(json!({}));
    let err = harness
        .run("counterSet", json!({ "target": TARGET, "value": "lots" }))
        .unwrap_err();
    assert!(err.contains("not a number"), "{err}");
    assert_eq!(harness.stored(), None);
}

// The lifetime setting is what decides whether the engine clears the value
// when the stream session ends.
#[test]
fn a_session_counter_is_written_to_be_cleared_when_the_session_ends() {
    for (lifetime, cleared) in [("session", true), ("forever", false)] {
        let harness = counter(json!({ "lifetime": lifetime }));
        harness
            .run("counterIncrement", json!({ "target": TARGET }))
            .unwrap();
        let options = harness.storage.write_options.lock().unwrap();
        assert_eq!(
            options[0].clear_on_session_end, cleared,
            "lifetime {lifetime}"
        );
    }
}

// The reason every write is a compare-and-set: a concurrent change is retried
// from, not overwritten.
#[test]
fn an_increment_that_loses_a_race_retries_from_the_winning_value() {
    let harness = counter(json!({}));
    *harness.storage.lose_next_race.lock().unwrap() = Some(json!({ "value": 7, "reached": {} }));
    let result = harness
        .run("counterIncrement", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["previous"], 7);
    assert_eq!(result["next"], 8);
    assert_eq!(harness.stored(), Some(json!({ "value": 8, "reached": {} })));
}

#[test]
fn refuses_a_target_that_is_not_a_counter() {
    let harness = Harness::new(COUNTER_JS, TARGET, "timer", json!({}));
    let err = harness
        .run("counterIncrement", json!({ "target": TARGET }))
        .unwrap_err();
    assert!(err.contains("not a counter"), "{err}");
}

#[test]
fn refuses_a_counter_that_does_not_exist_or_was_not_chosen() {
    let harness = counter(json!({}));
    let missing = harness
        .run(
            "counterIncrement",
            json!({ "target": "woofx3:counter:gone" }),
        )
        .unwrap_err();
    assert!(missing.contains("does not exist"), "{missing}");
    let unchosen = harness.run("counterIncrement", json!({})).unwrap_err();
    assert!(unchosen.contains("no counter chosen"), "{unchosen}");
}

#[test]
fn a_change_is_announced_so_workflows_can_act_on_it() {
    let harness = counter(json!({ "initialValue": 4 }));
    harness
        .run("counterIncrement", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(
        harness.take_events(),
        [(
            "counter.changed".to_string(),
            json!({ "target": TARGET, "previous": 4, "next": 5 })
        )]
    );
}

#[test]
fn setting_a_counter_to_the_value_it_holds_announces_nothing() {
    let harness = counter(json!({ "initialValue": 4 }));
    harness
        .run("counterSet", json!({ "target": TARGET, "value": 4 }))
        .unwrap();
    assert!(harness.take_events().is_empty());
}

// Goals: a counter announces reaching the numbers its instance carries.

/// The `goal.reached` events the last run asked to publish, in order, with the
/// `counter.changed` that accompanies them dropped.
fn goals_reached(harness: &Harness) -> Vec<serde_json::Value> {
    harness
        .take_events()
        .into_iter()
        .filter(|(event_type, _)| event_type == "goal.reached")
        .map(|(_, data)| data)
        .collect()
}

fn add(harness: &Harness, amount: i64) -> serde_json::Value {
    harness
        .run(
            "counterIncrement",
            json!({ "target": TARGET, "amount": amount }),
        )
        .unwrap()
}

// A counter with no goals is what a counter has always been.
#[test]
fn a_counter_with_no_goals_announces_none() {
    let harness = counter(json!({}));
    for _ in 0..3 {
        add(&harness, 100);
    }
    assert!(goals_reached(&harness).is_empty());
    assert_eq!(harness.stored().unwrap()["value"], 300);
}

// Reaching a goal is an edge: the change that carries the counter across it
// announces, and the ones that climb further past it do not.
#[test]
fn reaching_a_goal_announces_it_once() {
    let harness = counter(json!({ "goals": "100" }));

    add(&harness, 60);
    assert!(goals_reached(&harness).is_empty());

    add(&harness, 40);
    let events = goals_reached(&harness);
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(events[0]["target"], TARGET);
    assert_eq!(events[0]["previous"], 60);
    assert_eq!(events[0]["next"], 100);
    assert_eq!(events[0]["goal"], 100);
    assert_eq!(events[0]["first"], true);
    assert!(events[0]["firstReachedAt"].as_f64().unwrap() > 0.0);

    add(&harness, 500);
    assert!(
        goals_reached(&harness).is_empty(),
        "climbing past a goal announces nothing more"
    );
}

// The reason a counter carries a list rather than one target.
#[test]
fn every_goal_a_single_change_crosses_is_announced_smallest_first() {
    let harness = counter(json!({ "goals": "500, 100, 250" }));

    add(&harness, 600);
    let events = goals_reached(&harness);
    let goals: Vec<i64> = events
        .iter()
        .map(|event| event["goal"].as_i64().unwrap())
        .collect();
    assert_eq!(goals, vec![100, 250, 500]);
    assert!(events.iter().all(|event| event["first"] == true));
}

#[test]
fn goals_are_announced_as_the_counter_climbs_past_them_in_turn() {
    let harness = counter(json!({ "goals": "100, 250" }));

    add(&harness, 100);
    assert_eq!(goals_reached(&harness)[0]["goal"], 100);

    add(&harness, 100);
    assert!(goals_reached(&harness).is_empty());

    add(&harness, 50);
    assert_eq!(goals_reached(&harness)[0]["goal"], 250);
}

// Off by default: passing a goal again after a correction is usually the
// correction, not a second reason to celebrate.
#[test]
fn reaching_a_goal_again_announces_nothing_by_default() {
    let harness = counter(json!({ "goals": "10" }));

    add(&harness, 10);
    assert_eq!(goals_reached(&harness).len(), 1);

    harness
        .run("counterDecrement", json!({ "target": TARGET, "amount": 6 }))
        .unwrap();
    add(&harness, 6);
    assert!(goals_reached(&harness).is_empty());
}

#[test]
fn a_counter_set_to_announce_every_time_announces_each_crossing() {
    let harness = counter(json!({ "goals": "10", "announceEveryTime": true }));

    add(&harness, 10);
    let first = goals_reached(&harness);
    assert_eq!(first[0]["first"], true);
    let first_at = first[0]["firstReachedAt"].clone();

    harness
        .run("counterDecrement", json!({ "target": TARGET, "amount": 6 }))
        .unwrap();
    add(&harness, 6);

    let again = goals_reached(&harness);
    assert_eq!(again.len(), 1);
    assert_eq!(again[0]["first"], false);
    assert_eq!(
        again[0]["firstReachedAt"], first_at,
        "the first crossing is still the one that is remembered"
    );
}

#[test]
fn reset_forgets_which_goals_were_reached() {
    let harness = counter(json!({ "goals": "10" }));

    add(&harness, 10);
    assert_eq!(goals_reached(&harness).len(), 1);

    harness
        .run("counterReset", json!({ "target": TARGET }))
        .unwrap();
    assert!(
        goals_reached(&harness).is_empty(),
        "a reset does not itself reach a goal"
    );

    add(&harness, 10);
    assert_eq!(goals_reached(&harness)[0]["first"], true);
}

// The action reports what it reached, so a workflow can branch on it without
// waiting for the trigger.
#[test]
fn the_action_reports_the_goals_it_reached() {
    let harness = counter(json!({ "goals": "100, 250" }));
    let result = add(&harness, 300);
    assert_eq!(result["reached"], json!([100, 250]));

    let quiet = add(&harness, 1);
    assert_eq!(quiet["reached"], json!([]));
}

// A typo in an optional setting must not stop the counter counting.
#[test]
fn an_unreadable_goal_is_skipped_rather_than_failing_the_change() {
    let harness = counter(json!({ "goals": "100, soon, 250" }));
    let result = add(&harness, 300);
    assert_eq!(result["next"], 300);
    assert_eq!(result["reached"], json!([100, 250]));
}

// Counters written before goals existed hold a bare number, and must keep
// reading correctly rather than restarting from their initial value.
#[test]
fn a_counter_stored_as_a_bare_number_still_reads() {
    let harness = counter(json!({ "goals": "100", "initialValue": 0 }));
    harness.store(json!(60));

    let result = add(&harness, 40);
    assert_eq!(result["previous"], 60);
    assert_eq!(result["next"], 100);
    assert_eq!(goals_reached(&harness)[0]["goal"], 100);
    assert_eq!(harness.stored().unwrap()["value"], 100);
}

// A goal removed from the counter loses its record, so adding it back lets it
// be reached for the first time again.
#[test]
fn only_goals_the_counter_still_carries_are_recorded() {
    let harness = counter(json!({ "goals": "100, 250" }));
    add(&harness, 300);
    assert_eq!(harness.stored().unwrap()["reached"]["100"].is_null(), false);

    let narrowed = Harness::new(COUNTER_JS, TARGET, "counter", json!({ "goals": "250" }));
    narrowed.store(harness.stored().unwrap());
    narrowed
        .run("counterIncrement", json!({ "target": TARGET, "amount": 1 }))
        .unwrap();

    let reached = narrowed.stored().unwrap()["reached"].clone();
    assert!(reached["100"].is_null(), "a dropped goal keeps no record");
    assert!(!reached["250"].is_null(), "a kept goal keeps its record");
}

// Goals set as rows, each with an optional name the announcement carries.
#[test]
fn a_named_goal_is_announced_with_its_name() {
    let harness = counter(json!({ "goals": [
        { "value": 50, "name": "New emote" },
        { "value": 100 }
    ] }));

    add(&harness, 120);
    let events = goals_reached(&harness);
    assert_eq!(events.len(), 2, "{events:?}");
    assert_eq!(events[0]["goal"], 50);
    assert_eq!(events[0]["goalName"], "New emote");
    assert_eq!(events[1]["goal"], 100);
    assert_eq!(events[1]["goalName"], "");
}

// A goal set up before goals had names was a comma-separated string; it reads
// as goals without names.
#[test]
fn goals_written_as_a_string_are_announced_without_names() {
    let harness = counter(json!({ "goals": "100" }));
    add(&harness, 100);
    let events = goals_reached(&harness);
    assert_eq!(events[0]["goal"], 100);
    assert_eq!(events[0]["goalName"], "");
}

#[test]
fn a_row_whose_number_is_not_a_number_is_skipped() {
    let harness = counter(json!({ "goals": [
        { "value": "", "name": "Unfinished" },
        { "value": "lots" },
        { "name": "No number" },
        { "value": "25", "name": "Typed as text" }
    ] }));
    add(&harness, 30);
    let events = goals_reached(&harness);
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(events[0]["goal"], 25);
    assert_eq!(events[0]["goalName"], "Typed as text");
}

// Two rows for one number are one goal, announced once, under the first name.
#[test]
fn rows_with_the_same_number_are_one_goal() {
    let harness = counter(json!({ "goals": [
        { "value": 10 },
        { "value": 10, "name": "Ten" },
        { "value": 10, "name": "Also ten" }
    ] }));
    add(&harness, 10);
    let events = goals_reached(&harness);
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(events[0]["goalName"], "Ten");
}
