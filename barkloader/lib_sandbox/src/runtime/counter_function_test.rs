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
    assert_eq!(
        result,
        json!({ "target": TARGET, "previous": 10, "next": 15 })
    );
    assert_eq!(harness.stored(), Some(json!(15)));
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
    *harness.storage.lose_next_race.lock().unwrap() = Some(json!(7));
    let result = harness
        .run("counterIncrement", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(result["previous"], 7);
    assert_eq!(result["next"], 8);
    assert_eq!(harness.stored(), Some(json!(8)));
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
