//! The bundled woofx3 module's queue functions.

use crate::runtime::resource_function_harness::Harness;
use serde_json::{Value, json};

const QUEUE_JS: &str = include_str!("../../../../modules/woofx3/functions/queue.js");
const TARGET: &str = "woofx3:queue:viewers";

fn queue(settings: Value) -> Harness {
    Harness::new(QUEUE_JS, TARGET, "queue", settings)
}

fn add(harness: &Harness, entry: &str) -> Value {
    harness
        .run("queueAdd", json!({ "target": TARGET, "entry": entry }))
        .unwrap()
}

#[test]
fn entries_join_at_the_back_and_leave_from_the_front() {
    let harness = queue(json!({}));
    assert_eq!(
        add(&harness, "alice"),
        json!({ "target": TARGET, "entry": "alice", "added": true, "reason": "", "position": 1, "size": 1 })
    );
    assert_eq!(add(&harness, "bob")["position"], 2);
    assert_eq!(harness.stored(), Some(json!(["alice", "bob"])));

    let next = harness
        .run("queueNext", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(
        next,
        json!({ "target": TARGET, "entry": "alice", "taken": true, "size": 1 })
    );
    assert_eq!(harness.stored(), Some(json!(["bob"])));
}

#[test]
fn taking_from_an_empty_queue_reports_nothing_taken() {
    let harness = queue(json!({}));
    let next = harness
        .run("queueNext", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(
        next,
        json!({ "target": TARGET, "entry": "", "taken": false, "size": 0 })
    );
    assert_eq!(harness.stored(), None, "nothing to change, nothing written");
}

#[test]
fn a_duplicate_keeps_its_place_unless_duplicates_are_allowed() {
    let harness = queue(json!({}));
    add(&harness, "alice");
    add(&harness, "bob");
    let again = add(&harness, "alice");
    assert_eq!(again["added"], false);
    assert_eq!(again["reason"], "duplicate");
    assert_eq!(again["position"], 1);
    assert_eq!(harness.stored(), Some(json!(["alice", "bob"])));

    let harness = queue(json!({ "allowDuplicates": true }));
    add(&harness, "alice");
    assert_eq!(add(&harness, "alice")["position"], 2);
}

#[test]
fn a_full_queue_refuses_more() {
    let harness = queue(json!({ "capacity": 2 }));
    add(&harness, "alice");
    add(&harness, "bob");
    let refused = add(&harness, "carol");
    assert_eq!(refused["added"], false);
    assert_eq!(refused["reason"], "full");
    assert_eq!(refused["position"], 0);
    assert_eq!(refused["size"], 2);
}

// Capacity 0 means "no limit of its own", which is still the hard limit every
// queue has.
#[test]
fn a_queue_without_a_capacity_stops_at_the_hard_limit() {
    let harness = queue(json!({ "capacity": 0, "allowDuplicates": true }));
    let full: Vec<Value> = (0..1000).map(|n| json!(format!("viewer{n}"))).collect();
    harness.store(Value::Array(full));
    assert_eq!(add(&harness, "one more")["reason"], "full");
}

#[test]
fn entries_are_trimmed_and_an_empty_or_overlong_one_is_refused() {
    let harness = queue(json!({}));
    assert_eq!(add(&harness, "  alice  ")["entry"], "alice");

    let empty = harness
        .run("queueAdd", json!({ "target": TARGET, "entry": "   " }))
        .unwrap_err();
    assert!(empty.contains("no entry given"), "{empty}");
    let long = harness
        .run(
            "queueAdd",
            json!({ "target": TARGET, "entry": "x".repeat(501) }),
        )
        .unwrap_err();
    assert!(long.contains("over the 500 allowed"), "{long}");
    assert_eq!(harness.stored(), Some(json!(["alice"])));
}

#[test]
fn remove_takes_an_entry_out_from_anywhere_in_line() {
    let harness = queue(json!({}));
    for name in ["alice", "bob", "carol"] {
        add(&harness, name);
    }
    let removed = harness
        .run("queueRemove", json!({ "target": TARGET, "entry": "bob" }))
        .unwrap();
    assert_eq!(removed["removed"], true);
    assert_eq!(removed["position"], 2);
    assert_eq!(harness.stored(), Some(json!(["alice", "carol"])));

    let absent = harness
        .run("queueRemove", json!({ "target": TARGET, "entry": "dave" }))
        .unwrap();
    assert_eq!(absent["removed"], false);
    assert_eq!(absent["size"], 2);
}

#[test]
fn clear_empties_the_queue() {
    let harness = queue(json!({}));
    add(&harness, "alice");
    add(&harness, "bob");
    let cleared = harness
        .run("queueClear", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(
        cleared,
        json!({ "target": TARGET, "removed": 2, "size": 0 })
    );
    assert_eq!(harness.stored(), Some(json!([])));
}

#[test]
fn a_session_queue_is_written_to_be_cleared_when_the_session_ends() {
    for (lifetime, cleared) in [("session", true), ("forever", false)] {
        let harness = queue(json!({ "lifetime": lifetime }));
        add(&harness, "alice");
        let options = harness.storage.write_options.lock().unwrap();
        assert_eq!(
            options[0].clear_on_session_end, cleared,
            "lifetime {lifetime}"
        );
    }
}

// Two viewers joining at once must both end up in line.
#[test]
fn an_add_that_loses_a_race_retries_from_the_winning_value() {
    let harness = queue(json!({}));
    *harness.storage.lose_next_race.lock().unwrap() = Some(json!(["alice"]));
    let result = add(&harness, "bob");
    assert_eq!(result["position"], 2);
    assert_eq!(harness.stored(), Some(json!(["alice", "bob"])));
}

#[test]
fn refuses_a_target_that_is_not_a_queue() {
    let harness = Harness::new(QUEUE_JS, TARGET, "counter", json!({}));
    let err = harness
        .run("queueNext", json!({ "target": TARGET }))
        .unwrap_err();
    assert!(err.contains("not a queue"), "{err}");
}

#[test]
fn refuses_a_queue_that_does_not_exist_or_was_not_chosen() {
    let harness = queue(json!({}));
    let missing = harness
        .run("queueNext", json!({ "target": "woofx3:queue:gone" }))
        .unwrap_err();
    assert!(missing.contains("does not exist"), "{missing}");
    let unchosen = harness.run("queueNext", json!({})).unwrap_err();
    assert!(unchosen.contains("no queue chosen"), "{unchosen}");
}

#[test]
fn joining_and_taking_the_next_entry_are_announced() {
    let harness = queue(json!({}));
    add(&harness, "alice");
    harness
        .run("queueNext", json!({ "target": TARGET }))
        .unwrap();
    assert_eq!(
        harness.take_events(),
        [
            (
                "queue.added".to_string(),
                json!({ "target": TARGET, "entry": "alice", "added": true, "reason": "", "position": 1, "size": 1 })
            ),
            (
                "queue.next".to_string(),
                json!({ "target": TARGET, "entry": "alice", "taken": true, "size": 0 })
            ),
        ]
    );
}

#[test]
fn a_refused_entry_or_an_empty_queue_announces_nothing() {
    let harness = queue(json!({ "capacity": 1 }));
    add(&harness, "alice");
    harness.take_events();
    add(&harness, "alice");
    add(&harness, "bob");
    harness
        .run("queueRemove", json!({ "target": TARGET, "entry": "alice" }))
        .unwrap();
    harness
        .run("queueNext", json!({ "target": TARGET }))
        .unwrap();
    assert!(harness.take_events().is_empty());
}

const DESTINATION: &str = "woofx3:queue:on_stream";

fn two_queues(destination_settings: Value) -> Harness {
    queue(json!({})).with_instance(DESTINATION, "queue", destination_settings)
}

fn move_entry(harness: &Harness, entry: &str) -> Value {
    harness
        .run(
            "queueMove",
            json!({ "target": TARGET, "destination": DESTINATION, "entry": entry }),
        )
        .unwrap()
}

#[test]
fn moving_takes_the_entry_to_the_back_of_the_other_queue_and_announces_it_joining() {
    let harness = two_queues(json!({}));
    harness.store(json!(["alice", "bob"]));
    harness
        .run(
            "queueAdd",
            json!({ "target": DESTINATION, "entry": "carol" }),
        )
        .unwrap();
    harness.take_events();

    assert_eq!(
        move_entry(&harness, "bob"),
        json!({ "target": TARGET, "destination": DESTINATION, "entry": "bob", "moved": true, "reason": "", "position": 2, "size": 1 })
    );
    assert_eq!(harness.stored(), Some(json!(["alice"])));
    assert_eq!(
        harness.stored_at(DESTINATION),
        Some(json!(["carol", "bob"]))
    );
    let events = harness.take_events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].0, "queue.added");
    assert_eq!(events[0].1["target"], DESTINATION);
    assert_eq!(events[0].1["entry"], "bob");
}

#[test]
fn an_entry_the_other_queue_refuses_stays_where_it_is() {
    let harness = two_queues(json!({ "capacity": 1 }));
    harness.store(json!(["alice", "bob"]));
    assert_eq!(move_entry(&harness, "alice")["moved"], true);
    harness.take_events();

    let refused = move_entry(&harness, "bob");
    assert_eq!(refused["moved"], false);
    assert_eq!(refused["reason"], "full");
    assert_eq!(harness.stored(), Some(json!(["bob"])));
    assert_eq!(harness.take_events(), vec![]);
}

#[test]
fn moving_an_entry_that_is_not_there_reports_it_missing() {
    let harness = two_queues(json!({}));
    let missing = move_entry(&harness, "nobody");
    assert_eq!(missing["moved"], false);
    assert_eq!(missing["reason"], "missing");
    assert_eq!(harness.stored_at(DESTINATION), None);
}

#[test]
fn a_queue_cannot_move_an_entry_to_itself() {
    let harness = two_queues(json!({}));
    harness.store(json!(["alice"]));
    let refused = harness.run(
        "queueMove",
        json!({ "target": TARGET, "destination": TARGET, "entry": "alice" }),
    );
    assert!(refused.unwrap_err().contains("to itself"));
    assert_eq!(harness.stored(), Some(json!(["alice"])));
}
