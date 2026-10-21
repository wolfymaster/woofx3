//! The reserved-subjects contract shared with the workflow engine and the api,
//! and the rule barkloader derives from it for the events a manifest declares.
//!
//! A webhook handler may publish any event type its module declares as an
//! eventbus trigger, verbatim, so declaring a reserved subject would let an
//! upload drive the engine (a command subject) or forge a fact the engine
//! asserts (an engine-asserted subject). See docs/services/engine-integrity.md.

use std::sync::LazyLock;

use serde::Deserialize;

use crate::manifest_validate::InstallProvenance;
use crate::module_manifest::WEBHOOK_EVENT_PREFIX;

/// The contract, compiled in so a release carries the list it was built with.
const CONTRACT_JSON: &str = include_str!("../../../shared/common/contracts/reserved-subjects.json");

/// The namespace the engine publishes module lifecycle events in, and in which
/// an upload may declare events only under its own id.
const MODULE_NAMESPACE: &str = "module.";

/// The lists of shared/common/contracts/reserved-subjects.json barkloader
/// enforces. The contract's other lists (engine-asserted subjects, platform
/// events) bind workflows and the api, not manifests, and are not read here.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReservedSubjects {
    /// Subjects the engine and its services treat as commands.
    pub command_subject_prefixes: Vec<String>,
    /// Engine-asserted events an upload may not declare, on top of the
    /// command subjects. Platform events a platform module brings are left
    /// out.
    pub upload_reserved_prefixes: Vec<String>,
    /// Second tokens of the `module.<segment>` subjects the engine publishes;
    /// a module whose id is one of these gets no own namespace.
    pub engine_module_segments: Vec<String>,
}

/// Parsed on first use; `load_contract` forces it at startup so a malformed
/// contract stops the process there instead of panicking inside an upload.
pub static RESERVED_SUBJECTS: LazyLock<ReservedSubjects> = LazyLock::new(|| {
    serde_json::from_str(CONTRACT_JSON)
        .expect("shared/common/contracts/reserved-subjects.json must match ReservedSubjects")
});

/// Parses the compiled-in contract now. Call once from `main`.
pub fn load_contract() {
    LazyLock::force(&RESERVED_SUBJECTS);
}

/// The reservation `event` falls under when a module of `provenance` with id
/// `module_id` declares it as a bus-fired trigger, or `None` when it may.
///
/// Every entry matches as a prefix here, so an exact-name entry such as
/// `message.send` also reserves `message.send.later`; barkloader is stricter
/// than the workflow engine on purpose, since a manifest has no reason to
/// declare a near-twin of a command subject.
///
/// The bundled system module owns the outbox and engine-asserted triggers it
/// binds (`db.workflow.*`, `chat.command.*`, `viewer.*`), so it is held only
/// to the webhook prefix.
pub fn declared_event_reservation(
    event: &str,
    module_id: &str,
    provenance: InstallProvenance,
) -> Option<&'static str> {
    match provenance {
        InstallProvenance::System => event
            .starts_with(WEBHOOK_EVENT_PREFIX)
            .then_some(WEBHOOK_EVENT_PREFIX),
        InstallProvenance::User => {
            let reserved = &*RESERVED_SUBJECTS;
            reserved
                .command_subject_prefixes
                .iter()
                .chain(&reserved.upload_reserved_prefixes)
                .map(String::as_str)
                .find(|entry| {
                    event.starts_with(entry)
                        && !(*entry == MODULE_NAMESPACE
                            && in_own_module_namespace(event, module_id))
                })
        }
    }
}

/// Whether `event` lies in `module.<module_id>.`, the namespace a module may
/// declare its own events in.
///
/// A dotted id has no own namespace: `module.a.b.x` would sit in both
/// `module.a.` and `module.a.b.`, letting module `a` speak for module `a.b`.
/// Nor does an id that names an engine module namespace, or module `change`
/// could declare the engine's `module.change.add`.
fn in_own_module_namespace(event: &str, module_id: &str) -> bool {
    if module_id.is_empty() || module_id.contains('.') {
        return false;
    }
    if RESERVED_SUBJECTS
        .engine_module_segments
        .iter()
        .any(|segment| segment == module_id)
    {
        return false;
    }
    event
        .strip_prefix(MODULE_NAMESPACE)
        .and_then(|rest| rest.strip_prefix(module_id))
        .and_then(|rest| rest.strip_prefix('.'))
        .is_some_and(|name| !name.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_reserved_subjects_contract_parses() {
        let reserved = &*RESERVED_SUBJECTS;
        assert!(!reserved.command_subject_prefixes.is_empty());
        assert!(!reserved.upload_reserved_prefixes.is_empty());
        assert!(!reserved.engine_module_segments.is_empty());
    }

    #[test]
    fn test_reserved_subjects_webhook_prefix_is_a_command_subject() {
        assert!(
            RESERVED_SUBJECTS
                .command_subject_prefixes
                .iter()
                .any(|entry| entry == WEBHOOK_EVENT_PREFIX),
            "the webhook prefix must stay reserved for every upload"
        );
    }

    #[test]
    fn test_in_own_module_namespace() {
        for (event, module_id, own) in [
            ("module.store.order", "store", true),
            ("module.store.order.created", "store", true),
            ("module.store.", "store", false),
            ("module.store", "store", false),
            ("module.storefront.order", "store", false),
            ("module.other.order", "store", false),
            ("store.order", "store", false),
            ("module.a.b.x", "a.b", false),
            ("module.change.add", "change", false),
            ("module.storage.x.changed", "storage", false),
        ] {
            assert_eq!(
                in_own_module_namespace(event, module_id),
                own,
                "{event} for module {module_id}"
            );
        }
    }
}
