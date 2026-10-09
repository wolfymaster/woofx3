//! Which resource kind a `resource_ref` field or setting names.
//!
//! A kind is identified by the module that declares it and its name within
//! that module: `{module}:{kind}`, the leading two segments of every instance's
//! canonical id. Kind names are an open namespace, so two modules may each
//! declare a `wheel`; the module segment is what keeps their instances apart.
//!
//! A manifest may write a bare kind (`"timer"`) or a qualified one
//! (`"woofx3:timer"`). Install qualifies every bare kind before the manifest is
//! validated, registered or stored, so everything downstream (the stored
//! manifest, registered schemas, the dashboard) sees only qualified kinds, and
//! a module installed later that declares the same name cannot change what an
//! earlier install meant.
//!
//! A bare kind means the declaring module's own kind when it has one, and
//! otherwise the one installed module that declares it. Missing or ambiguous is
//! an install error: there is nothing sound to guess.

use anyhow::{Result, anyhow};

use super::canonical_id::{CANONICAL_ID_SEPARATOR, validate_segment};
use super::module_manifest::{ManifestConfigField, ModuleManifest};
use super::theme::InstalledModule;

/// A `resourceKind` value, split. `module` is `None` for a bare kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KindRef<'a> {
    pub module: Option<&'a str>,
    pub kind: &'a str,
}

/// Parse `kind` or `module:kind`, checking each segment.
pub fn parse_kind_ref<'a>(raw: &'a str, label: &str) -> Result<KindRef<'a>> {
    let mut parts = raw.split(CANONICAL_ID_SEPARATOR);
    let first = parts.next().unwrap_or_default();
    let second = parts.next();
    if parts.next().is_some() {
        return Err(anyhow!(
            "{label} {raw:?} has too many segments; write `kind` or `module:kind`"
        ));
    }
    match second {
        None => {
            validate_segment(first, label)?;
            Ok(KindRef {
                module: None,
                kind: first,
            })
        }
        Some(kind) => {
            validate_segment(first, &format!("{label} module"))?;
            validate_segment(kind, label)?;
            Ok(KindRef {
                module: Some(first),
                kind,
            })
        }
    }
}

/// Whether `manifest` names a kind it does not declare itself, which only the
/// installed modules can resolve. Install reads them only then.
pub fn names_other_modules_kinds(manifest: &ModuleManifest) -> bool {
    let mut probe = manifest.clone();
    let mut found = false;
    let _ = for_each_kind_ref(&mut probe, &mut |raw, _| {
        if let Ok(parsed) = parse_kind_ref(raw, "resourceKind") {
            let own_module = parsed.module.is_none_or(|m| m == manifest.id);
            let declared = manifest.resources.iter().any(|r| r.kind == parsed.kind);
            found |= !(own_module && declared);
        }
        Ok(())
    });
    found
}

/// `manifest` with every `resourceKind` written as `{module}:{kind}`.
///
/// `installed` is every module already installed; a row for an earlier version
/// of the module being installed is ignored, since the manifest at hand is what
/// that module declares from now on. A value that does not parse is left as it
/// is, for validation to reject with its own context.
pub fn qualify_resource_kinds(
    manifest: &ModuleManifest,
    installed: &[InstalledModule],
) -> Result<ModuleManifest> {
    let mut out = manifest.clone();
    let resolver = Resolver {
        installing: manifest,
        installed,
    };
    for_each_kind_ref(&mut out, &mut |raw, context| resolver.qualify(raw, context))?;
    Ok(out)
}

/// Every place a manifest names a resource kind, with where it is for errors.
fn for_each_kind_ref(
    manifest: &mut ModuleManifest,
    visit: &mut dyn FnMut(&mut String, &str) -> Result<()>,
) -> Result<()> {
    for trigger in &mut manifest.triggers {
        if let Some(schema) = trigger.schema.as_mut() {
            visit_fields(schema, &format!("trigger `{}`", trigger.id), visit)?;
        }
    }
    for action in &mut manifest.actions {
        visit_fields(
            &mut action.schema,
            &format!("action `{}`", action.id),
            visit,
        )?;
    }
    for widget in &mut manifest.widgets {
        if let Some(schema) = widget.settings_schema.as_mut() {
            visit_fields(schema, &format!("widget `{}`", widget.id), visit)?;
        }
    }
    for resource in &mut manifest.resources {
        let context = format!("resource kind `{}`", resource.kind);
        visit_fields(&mut resource.schema, &context, visit)?;
    }
    for setting in &mut manifest.settings {
        let context = format!("setting `{}`", setting.id);
        if let Some(kind) = setting.resource_kind.as_mut() {
            visit(kind, &context)?;
        }
        if let Some(items) = setting.item_fields.as_mut() {
            visit_fields(items, &context, visit)?;
        }
    }
    Ok(())
}

fn visit_fields(
    fields: &mut [ManifestConfigField],
    context: &str,
    visit: &mut dyn FnMut(&mut String, &str) -> Result<()>,
) -> Result<()> {
    for field in fields {
        let field_context = format!("{context} field `{}`", field.id);
        if let Some(kind) = field.resource_kind.as_mut() {
            visit(kind, &field_context)?;
        }
        if let Some(items) = field.item_fields.as_mut() {
            visit_fields(items, &field_context, visit)?;
        }
    }
    Ok(())
}

struct Resolver<'a> {
    installing: &'a ModuleManifest,
    installed: &'a [InstalledModule],
}

impl Resolver<'_> {
    fn qualify(&self, raw: &mut String, context: &str) -> Result<()> {
        let Ok(parsed) = parse_kind_ref(raw, "resourceKind") else {
            return Ok(());
        };
        let owner = match parsed.module {
            Some(module) => {
                if !self.declares(module, parsed.kind) {
                    return Err(anyhow!(
                        "{context}: no installed module `{module}` provides `{}` resources; install it first",
                        parsed.kind
                    ));
                }
                module.to_string()
            }
            None => self
                .owner_of(parsed.kind)
                .map_err(|e| anyhow!("{context}: {e}"))?,
        };
        *raw = format!("{owner}{CANONICAL_ID_SEPARATOR}{}", parsed.kind);
        Ok(())
    }

    fn declares(&self, module: &str, kind: &str) -> bool {
        if module == self.installing.id {
            return self.installing.resources.iter().any(|r| r.kind == kind);
        }
        self.others()
            .any(|m| m.module_id == module && m.manifest.resources.iter().any(|r| r.kind == kind))
    }

    /// The module a bare kind means: the installing module's own, else the one
    /// installed module that declares it.
    fn owner_of(&self, kind: &str) -> Result<String> {
        if self.installing.resources.iter().any(|r| r.kind == kind) {
            return Ok(self.installing.id.clone());
        }
        let mut owners: Vec<&str> = self
            .others()
            .filter(|m| m.manifest.resources.iter().any(|r| r.kind == kind))
            .map(|m| m.module_id.as_str())
            .collect();
        owners.sort_unstable();
        owners.dedup();
        match owners.as_slice() {
            [owner] => Ok((*owner).to_string()),
            [] => Err(anyhow!(
                "no installed module provides `{kind}` resources; install the module that does first"
            )),
            many => Err(anyhow!(
                "several installed modules provide `{kind}` resources ({}); write `module:{kind}` to say which",
                many.join(", ")
            )),
        }
    }

    fn others(&self) -> impl Iterator<Item = &InstalledModule> {
        self.installed
            .iter()
            .filter(|m| m.module_id != self.installing.id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(json: &str) -> ModuleManifest {
        serde_json::from_str(json).expect("manifest parses")
    }

    fn installed(id: &str, kinds: &[&str]) -> InstalledModule {
        let resources: Vec<String> = kinds
            .iter()
            .map(|k| format!(r#"{{ "kind": "{k}", "name": "{k}" }}"#))
            .collect();
        InstalledModule {
            module_id: id.to_string(),
            version: "1.0.0".to_string(),
            version_dir: "abc".to_string(),
            manifest: manifest(&format!(
                r#"{{ "id": "{id}", "name": "{id}", "version": "1.0.0", "resources": [{}] }}"#,
                resources.join(",")
            )),
        }
    }

    fn with_action_ref(id: &str, own_kinds: &[&str], resource_kind: &str) -> ModuleManifest {
        let resources: Vec<String> = own_kinds
            .iter()
            .map(|k| format!(r#"{{ "kind": "{k}", "name": "{k}" }}"#))
            .collect();
        manifest(&format!(
            r#"{{
                "id": "{id}", "name": "{id}", "version": "1.0.0",
                "resources": [{}],
                "actions": [{{ "id": "go", "name": "Go", "type": "function", "function": "go",
                    "schema": [{{ "id": "target", "label": "T", "type": "resource_ref", "resourceKind": "{resource_kind}" }}] }}]
            }}"#,
            resources.join(",")
        ))
    }

    fn action_kind(m: &ModuleManifest) -> &str {
        m.actions[0].schema[0].resource_kind.as_deref().unwrap()
    }

    #[test]
    fn parses_bare_and_qualified_kinds() {
        assert_eq!(
            parse_kind_ref("timer", "k").unwrap(),
            KindRef {
                module: None,
                kind: "timer"
            }
        );
        assert_eq!(
            parse_kind_ref("woofx3:timer", "k").unwrap(),
            KindRef {
                module: Some("woofx3"),
                kind: "timer"
            }
        );
        assert!(parse_kind_ref("a:b:c", "k").is_err());
        assert!(parse_kind_ref(":timer", "k").is_err());
        assert!(parse_kind_ref("woofx3:", "k").is_err());
        assert!(parse_kind_ref("ti mer", "k").is_err());
    }

    #[test]
    fn a_bare_kind_the_module_declares_is_its_own() {
        let m = with_action_ref("wheels", &["wheel"], "wheel");
        let others = [installed("rival", &["wheel"])];
        let q = qualify_resource_kinds(&m, &others).unwrap();
        assert_eq!(action_kind(&q), "wheels:wheel");
    }

    #[test]
    fn a_bare_kind_another_module_declares_is_that_modules() {
        let m = with_action_ref("mine", &[], "timer");
        let q = qualify_resource_kinds(&m, &[installed("woofx3", &["timer", "counter"])]).unwrap();
        assert_eq!(action_kind(&q), "woofx3:timer");
    }

    #[test]
    fn a_bare_kind_two_modules_declare_is_refused() {
        let m = with_action_ref("mine", &[], "wheel");
        let err = qualify_resource_kinds(
            &m,
            &[installed("a", &["wheel"]), installed("b", &["wheel"])],
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("several installed modules"), "{err}");
        assert!(err.contains("action `go` field `target`"), "{err}");
    }

    #[test]
    fn a_bare_kind_nobody_declares_is_refused() {
        let m = with_action_ref("mine", &[], "wheel");
        let err = qualify_resource_kinds(&m, &[]).unwrap_err().to_string();
        assert!(
            err.contains("no installed module provides `wheel`"),
            "{err}"
        );
    }

    #[test]
    fn an_earlier_version_of_the_installing_module_does_not_count() {
        let m = with_action_ref("wheels", &[], "wheel");
        let err = qualify_resource_kinds(&m, &[installed("wheels", &["wheel"])])
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("no installed module provides `wheel`"),
            "{err}"
        );
    }

    #[test]
    fn a_qualified_kind_must_be_declared_by_that_module() {
        let m = with_action_ref("mine", &[], "b:wheel");
        let others = [installed("a", &["wheel"]), installed("b", &["wheel"])];
        assert_eq!(
            action_kind(&qualify_resource_kinds(&m, &others).unwrap()),
            "b:wheel"
        );

        let missing = with_action_ref("mine", &[], "c:wheel");
        let err = qualify_resource_kinds(&missing, &others)
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("no installed module `c` provides `wheel`"),
            "{err}"
        );

        let own = with_action_ref("mine", &["wheel"], "mine:wheel");
        assert_eq!(
            action_kind(&qualify_resource_kinds(&own, &[]).unwrap()),
            "mine:wheel"
        );
    }

    #[test]
    fn every_place_a_kind_can_be_named_is_qualified() {
        let m = manifest(
            r#"{
                "id": "mine", "name": "mine", "version": "1.0.0",
                "resources": [{ "kind": "wheel", "name": "Wheel",
                    "schema": [{ "id": "linked", "label": "L", "type": "resource_ref", "resourceKind": "timer" }] }],
                "triggers": [{ "id": "landed", "name": "Landed", "type": "eventbus", "event": "x.landed",
                    "schema": [{ "id": "wheel", "label": "W", "type": "resource_ref", "resourceKind": "wheel" }] }],
                "widgets": [{ "id": "w", "name": "W",
                    "settingsSchema": [{ "id": "wheel", "label": "W", "type": "resource_ref", "resourceKind": "wheel" }] }],
                "settings": [{ "id": "timer", "label": "Timer", "type": "resource_ref", "resourceKind": "timer" }]
            }"#,
        );
        let q = qualify_resource_kinds(&m, &[installed("woofx3", &["timer"])]).unwrap();
        assert_eq!(
            q.resources[0].schema[0].resource_kind.as_deref(),
            Some("woofx3:timer")
        );
        assert_eq!(
            q.triggers[0].schema.as_ref().unwrap()[0]
                .resource_kind
                .as_deref(),
            Some("mine:wheel")
        );
        assert_eq!(
            q.widgets[0].settings_schema.as_ref().unwrap()[0]
                .resource_kind
                .as_deref(),
            Some("mine:wheel")
        );
        assert_eq!(q.settings[0].resource_kind.as_deref(), Some("woofx3:timer"));
    }

    #[test]
    fn only_a_kind_the_module_does_not_declare_needs_the_installed_modules() {
        assert!(!names_other_modules_kinds(&with_action_ref(
            "mine",
            &["wheel"],
            "wheel"
        )));
        assert!(!names_other_modules_kinds(&with_action_ref(
            "mine",
            &["wheel"],
            "mine:wheel"
        )));
        assert!(names_other_modules_kinds(&with_action_ref(
            "mine",
            &["wheel"],
            "timer"
        )));
        assert!(names_other_modules_kinds(&with_action_ref(
            "mine",
            &[],
            "woofx3:timer"
        )));
        assert!(!names_other_modules_kinds(&manifest(
            r#"{ "id": "mine", "name": "mine", "version": "1.0.0" }"#
        )));
    }

    #[test]
    fn a_malformed_kind_is_left_for_validation() {
        let m = with_action_ref("mine", &[], "a:b:c");
        assert_eq!(
            action_kind(&qualify_resource_kinds(&m, &[]).unwrap()),
            "a:b:c"
        );
    }
}
