//! Widget themes: the rules a theme contract, a theme and a `requires` map
//! must follow, and how a selected theme resolves into what a widget frame
//! renders.
//!
//! A widget opts in by declaring a contract (`ModuleWidget::theme`). A theme
//! (`ManifestTheme`) is data only and targets one widget's contract. Nothing
//! here ever fails a render: resolution falls back to the contract defaults
//! whenever the selected theme is missing or no longer fits, because a theme
//! problem must never break a scene mid-stream.

use anyhow::{Result, anyhow};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};

use super::canonical_id::{CANONICAL_ID_SEPARATOR, validate_segment};
use super::db_proxy::ModuleRecord;
use super::module_manifest::{
    ManifestTheme, ModuleManifest, ModuleWidget, THEME_ASSET_KINDS, THEME_SETTING_ID,
    THEME_VARIABLE_TYPES, WidgetThemeContract, theme_asset_kind,
};

/// Parse a theme `target` into `(moduleId, widgetId)`. Only a widget can be
/// themed, so any other kind is refused.
pub fn parse_widget_target(target: &str) -> Result<(&str, &str)> {
    let parts: Vec<&str> = target.split(CANONICAL_ID_SEPARATOR).collect();
    if parts.len() != 3 || parts[1] != "widget" {
        return Err(anyhow!(
            "`target` must name a widget as `{{moduleId}}:widget:{{id}}`, got {target:?}"
        ));
    }
    validate_segment(parts[0], "`target` moduleId")?;
    validate_segment(parts[2], "`target` widget id")?;
    Ok((parts[0], parts[2]))
}

/// Parse a theme canonical id (`{moduleId}:theme:{id}`) into its parts, or
/// `None` for anything else. Settings values are user data, so a malformed
/// one is treated as "no theme selected", not as an error.
pub fn parse_theme_id(value: &str) -> Option<(&str, &str)> {
    let parts: Vec<&str> = value.split(CANONICAL_ID_SEPARATOR).collect();
    if parts.len() != 3 || parts[1] != "theme" {
        return None;
    }
    if validate_segment(parts[0], "moduleId").is_err() || validate_segment(parts[2], "id").is_err()
    {
        return None;
    }
    Some((parts[0], parts[2]))
}

/// Render a theme variable value as the CSS text of a custom property, or
/// explain why it does not fit `variable_type`.
///
/// The text is written into a `<style>` block and a widget's CSS, so the
/// rules below are what keep a value a value: nothing that ends the
/// declaration or the block (`;`, braces, `<`), no line breaks, no escapes,
/// balanced quotes, and no way to load a file - files come through asset
/// slots, where the engine controls the URL.
pub fn css_value(variable_type: &str, value: &serde_json::Value) -> Result<String> {
    let text = match variable_type {
        "number" => {
            let Some(n) = value.as_f64().filter(|n| n.is_finite()) else {
                return Err(anyhow!(
                    "a `number` variable takes a finite number, got {value}"
                ));
            };
            return Ok(format_number(n));
        }
        "color" | "text" => value
            .as_str()
            .ok_or_else(|| anyhow!("a `{variable_type}` variable takes a string, got {value}"))?,
        other => {
            return Err(anyhow!(
                "unknown variable type {other:?}; expected one of {}",
                THEME_VARIABLE_TYPES.join(", ")
            ));
        }
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("a `{variable_type}` variable cannot be empty"));
    }
    if let Some(c) = trimmed
        .chars()
        .find(|c| matches!(c, ';' | '{' | '}' | '<' | '>' | '\\') || c.is_control())
    {
        return Err(anyhow!(
            "{trimmed:?} contains {c:?}, which a CSS value cannot carry here"
        ));
    }
    if trimmed.matches('"').count() % 2 != 0 || trimmed.matches('\'').count() % 2 != 0 {
        return Err(anyhow!("{trimmed:?} has an unbalanced quote"));
    }
    let lowered = trimmed.to_ascii_lowercase();
    for loader in ["url(", "image-set(", "@import", "expression("] {
        if lowered.contains(loader) {
            return Err(anyhow!(
                "{trimmed:?} loads a file; supply files through an asset slot instead"
            ));
        }
    }
    if variable_type == "color" && !looks_like_color(trimmed) {
        return Err(anyhow!(
            "{trimmed:?} is not a color: use #rgb, #rrggbb (with optional alpha), rgb(), rgba(), hsl(), hsla() or a color name"
        ));
    }
    Ok(trimmed.to_string())
}

fn format_number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

fn looks_like_color(value: &str) -> bool {
    if let Some(hex) = value.strip_prefix('#') {
        return matches!(hex.len(), 3 | 4 | 6 | 8) && hex.chars().all(|c| c.is_ascii_hexdigit());
    }
    let lowered = value.to_ascii_lowercase();
    for function in ["rgb(", "rgba(", "hsl(", "hsla("] {
        if let Some(args) = lowered.strip_prefix(function) {
            return args.ends_with(')')
                && args[..args.len() - 1]
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || " .,%/+-".contains(c));
        }
    }
    value.chars().all(|c| c.is_ascii_alphabetic())
}

/// Validate a widget's `theme` contract, where it has one.
pub fn validate_contract(widget: &ModuleWidget, label: &str) -> Result<()> {
    let Some(contract) = &widget.theme else {
        return Ok(());
    };
    if contract.contract_version == 0 {
        return Err(anyhow!("{label}: `theme.contractVersion` starts at 1"));
    }
    if contract.variables.is_empty() && contract.asset_slots.is_empty() {
        return Err(anyhow!(
            "{label}: `theme` must declare at least one variable or asset slot"
        ));
    }
    if let Some(fields) = &widget.settings_schema
        && fields.iter().any(|f| f.id.trim() == THEME_SETTING_ID)
    {
        return Err(anyhow!(
            "{label}: `settingsSchema` field id {THEME_SETTING_ID:?} is reserved for the theme picker the engine adds to a widget with a `theme` contract"
        ));
    }

    let mut seen: HashSet<&str> = HashSet::new();
    for (i, variable) in contract.variables.iter().enumerate() {
        let context = format!("{label}: `theme.variables` #{i}");
        validate_segment(&variable.id, &format!("{context} id"))?;
        if !seen.insert(&variable.id) {
            return Err(anyhow!("{context}: duplicate id {:?}", variable.id));
        }
        if !THEME_VARIABLE_TYPES.contains(&variable.variable_type.as_str()) {
            return Err(anyhow!(
                "{context} ({}): unknown type {:?}; expected one of {}",
                variable.id,
                variable.variable_type,
                THEME_VARIABLE_TYPES.join(", ")
            ));
        }
        css_value(&variable.variable_type, &variable.default)
            .map_err(|e| anyhow!("{context} ({}): `default`: {e}", variable.id))?;
    }

    let mut seen: HashSet<&str> = HashSet::new();
    for (i, slot) in contract.asset_slots.iter().enumerate() {
        let context = format!("{label}: `theme.assetSlots` #{i}");
        validate_segment(&slot.id, &format!("{context} id"))?;
        if !seen.insert(&slot.id) {
            return Err(anyhow!("{context}: duplicate id {:?}", slot.id));
        }
        if slot.kinds.is_empty() {
            return Err(anyhow!(
                "{context} ({}): `kinds` must name at least one of {}",
                slot.id,
                THEME_ASSET_KINDS.join(", ")
            ));
        }
        for kind in &slot.kinds {
            if !THEME_ASSET_KINDS.contains(&kind.as_str()) {
                return Err(anyhow!(
                    "{context} ({}): unknown kind {kind:?}; expected one of {}",
                    slot.id,
                    THEME_ASSET_KINDS.join(", ")
                ));
            }
        }
        if let Some(default) = &slot.default {
            if widget_relative_path(widget, default).is_none() {
                return Err(anyhow!(
                    "{context} ({}): `default` {default:?} must be a file inside the widget's `assets` directory",
                    slot.id
                ));
            }
            check_asset_kind(default, &slot.kinds)
                .map_err(|e| anyhow!("{context} ({}): `default`: {e}", slot.id))?;
        }
    }
    Ok(())
}

/// A module-root path relative to the widget's `assets` directory, or `None`
/// when it is not inside it.
pub fn widget_relative_path(widget: &ModuleWidget, path: &str) -> Option<String> {
    let assets = widget.assets.as_deref()?;
    let prefix = format!("{}/", normalize(assets)?.trim_end_matches('/'));
    let normalized = normalize(path)?;
    let rel = normalized.strip_prefix(&prefix)?;
    if rel.is_empty() {
        return None;
    }
    Some(rel.to_string())
}

fn normalize(path: &str) -> Option<String> {
    let normalized = path
        .trim()
        .trim_start_matches("./")
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();
    if normalized.split('/').any(|segment| segment == "..") {
        return None;
    }
    Some(normalized)
}

fn check_asset_kind(path: &str, kinds: &[String]) -> Result<()> {
    let Some(kind) = theme_asset_kind(path) else {
        return Err(anyhow!(
            "{path:?} is no {} file this engine recognises by extension",
            THEME_ASSET_KINDS.join(", ")
        ));
    };
    if !kinds.iter().any(|k| k == kind) {
        return Err(anyhow!(
            "{path:?} is a {kind} file; this slot takes {}",
            kinds.join(", ")
        ));
    }
    Ok(())
}

/// The checks a theme passes on its own, before anything about its target is
/// known: well-formed ids and paths, and files of a kind a theme can carry.
pub fn validate_theme_shape(theme: &ManifestTheme, label: &str) -> Result<()> {
    if theme.name.trim().is_empty() {
        return Err(anyhow!("{label}: `name` must be non-empty"));
    }
    parse_widget_target(&theme.target).map_err(|e| anyhow!("{label}: {e}"))?;
    if theme.contract_version == 0 {
        return Err(anyhow!("{label}: `contractVersion` starts at 1"));
    }
    for id in theme.variables.keys() {
        validate_segment(id, &format!("{label}: `variables` key"))?;
    }
    for (slot, path) in &theme.assets {
        validate_segment(slot, &format!("{label}: `assets` key"))?;
        reject_escape(path, &format!("{label}: `assets.{slot}`"))?;
        if theme_asset_kind(path).is_none() {
            return Err(anyhow!(
                "{label}: `assets.{slot}` {path:?} is no {} file this engine recognises by extension",
                THEME_ASSET_KINDS.join(", ")
            ));
        }
    }
    if let Some(stylesheet) = &theme.stylesheet {
        reject_escape(stylesheet, &format!("{label}: `stylesheet`"))?;
        if !stylesheet.to_ascii_lowercase().ends_with(".css") {
            return Err(anyhow!(
                "{label}: `stylesheet` {stylesheet:?} must be a .css file"
            ));
        }
    }
    if let Some(preview) = &theme.preview {
        reject_escape(preview, &format!("{label}: `preview`"))?;
        if theme_asset_kind(preview) != Some("image") {
            return Err(anyhow!("{label}: `preview` {preview:?} must be an image"));
        }
    }
    Ok(())
}

fn reject_escape(path: &str, context: &str) -> Result<()> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("{context} must be a non-empty path"));
    }
    if trimmed.starts_with('/') || trimmed.starts_with('\\') || normalize(trimmed).is_none() {
        return Err(anyhow!(
            "{context} must be relative to the module root without `..`, got {path:?}"
        ));
    }
    Ok(())
}

/// Check a theme against the contract of the widget it targets: the same
/// contract version, and every variable and asset it sets declared by the
/// contract and fitting it.
pub fn check_against_contract(theme: &ManifestTheme, contract: &WidgetThemeContract) -> Result<()> {
    if theme.contract_version != contract.contract_version {
        return Err(anyhow!(
            "`contractVersion` {} does not match {}'s contract version {}",
            theme.contract_version,
            theme.target,
            contract.contract_version
        ));
    }
    for (id, value) in &theme.variables {
        let Some(variable) = contract.variables.iter().find(|v| &v.id == id) else {
            return Err(anyhow!(
                "`variables.{id}` is not a variable {}'s contract declares",
                theme.target
            ));
        };
        css_value(&variable.variable_type, value).map_err(|e| anyhow!("`variables.{id}`: {e}"))?;
    }
    for (id, path) in &theme.assets {
        let Some(slot) = contract.asset_slots.iter().find(|s| &s.id == id) else {
            return Err(anyhow!(
                "`assets.{id}` is not an asset slot {}'s contract declares",
                theme.target
            ));
        };
        check_asset_kind(path, &slot.kinds).map_err(|e| anyhow!("`assets.{id}`: {e}"))?;
    }
    Ok(())
}

/// Validate the shape of `requires`: each key a module id, each value a
/// semver range.
pub fn validate_requires_shape(requires: &BTreeMap<String, String>, own_id: &str) -> Result<()> {
    for (module_id, range) in requires {
        validate_segment(module_id, "`requires` key")?;
        if module_id == own_id {
            return Err(anyhow!(
                "`requires.{module_id}`: a module cannot require itself"
            ));
        }
        semver::VersionReq::parse(range.trim())
            .map_err(|e| anyhow!("`requires.{module_id}`: {range:?} is not a semver range: {e}"))?;
    }
    Ok(())
}

/// Check `requires` against the installed modules, `module id -> version`.
pub fn check_requires(
    requires: &BTreeMap<String, String>,
    installed: &HashMap<String, String>,
) -> Result<()> {
    let mut problems: Vec<String> = Vec::new();
    for (module_id, range) in requires {
        let req = semver::VersionReq::parse(range.trim())
            .map_err(|e| anyhow!("`requires.{module_id}`: {e}"))?;
        match installed.get(module_id) {
            None => problems.push(format!("{module_id} {range} is not installed")),
            Some(version) => match semver::Version::parse(version.trim()) {
                Ok(v) if req.matches(&v) => {}
                Ok(_) => problems.push(format!(
                    "{module_id} {range} is required but {version} is installed"
                )),
                Err(_) => problems.push(format!(
                    "{module_id} {range} is required but the installed version {version:?} is not semver"
                )),
            },
        }
    }
    if !problems.is_empty() {
        return Err(anyhow!(
            "`requires` is not satisfied: {}",
            problems.join("; ")
        ));
    }
    Ok(())
}

/// The widget a theme target names, looked up in `manifest`.
pub fn find_target_widget<'a>(
    manifest: &'a ModuleManifest,
    widget_id: &str,
) -> Option<&'a ModuleWidget> {
    manifest.widgets.iter().find(|w| w.id == widget_id)
}

/// Why a widget renders with its contract defaults instead of the theme its
/// settings name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeFallback {
    /// No installed module declares the selected theme.
    Missing,
    /// The theme exists but is for another widget, another contract version,
    /// or sets something the widget's current contract no longer declares.
    Incompatible,
}

/// What a widget frame renders with: the contract's variables and asset slots
/// filled from the selected theme where it fits, from the defaults otherwise.
/// Serialized as the frame response's `theme` and, from there, as the
/// widget's `host.theme`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTheme {
    /// The theme in effect, or `None` when the defaults are.
    pub id: Option<String>,
    pub contract_version: u32,
    /// Contract variable id to CSS value, every variable present.
    pub variables: BTreeMap<String, String>,
    /// Asset slot id to URL, `None` for a slot with nothing to show.
    pub assets: BTreeMap<String, Option<String>>,
    /// What each slot shows without a theme, for a widget that wants to fall
    /// back when a theme file fails to load in the browser.
    pub default_assets: BTreeMap<String, Option<String>>,
    pub stylesheet_url: Option<String>,
    /// Set when a theme was selected but the defaults are shown instead.
    pub fallback: Option<ThemeFallback>,
}

/// A theme selected in a widget's settings, as found among installed modules.
pub struct SelectedTheme<'a> {
    pub canonical_id: String,
    /// The theme's declaration and the public URL of its file directory
    /// (ending in `/`), or `None` when nothing installed declares it.
    pub found: Option<(&'a ManifestTheme, String)>,
    /// Module-root paths of this theme's asset files the repository no longer
    /// holds. Each such slot shows its default.
    pub missing_files: HashSet<String>,
}

/// Resolve what `widget` renders with. `widget_canonical_id` is the widget's
/// own id, so a theme for another widget is refused even if its contract
/// happens to fit. `widget_base_url` is the public URL of the widget's asset
/// root, ending in `/`.
pub fn resolve(
    widget: &ModuleWidget,
    widget_canonical_id: &str,
    widget_base_url: &str,
    selected: Option<SelectedTheme<'_>>,
) -> Option<ResolvedTheme> {
    let contract = widget.theme.as_ref()?;

    let mut variables: BTreeMap<String, String> = BTreeMap::new();
    for variable in &contract.variables {
        // Contract defaults were validated at install; one that no longer
        // renders is left out rather than failing the frame.
        if let Ok(css) = css_value(&variable.variable_type, &variable.default) {
            variables.insert(variable.id.clone(), css);
        }
    }
    let default_assets: BTreeMap<String, Option<String>> = contract
        .asset_slots
        .iter()
        .map(|slot| {
            let url = slot
                .default
                .as_deref()
                .and_then(|path| widget_relative_path(widget, path))
                .map(|rel| format!("{widget_base_url}{rel}"));
            (slot.id.clone(), url)
        })
        .collect();
    let mut resolved = ResolvedTheme {
        id: None,
        contract_version: contract.contract_version,
        variables,
        assets: default_assets.clone(),
        default_assets,
        stylesheet_url: None,
        fallback: None,
    };

    let Some(selected) = selected else {
        return Some(resolved);
    };
    let Some((theme, theme_base_url)) = selected.found else {
        resolved.fallback = Some(ThemeFallback::Missing);
        return Some(resolved);
    };
    if theme.target != widget_canonical_id || check_against_contract(theme, contract).is_err() {
        resolved.fallback = Some(ThemeFallback::Incompatible);
        return Some(resolved);
    }

    for variable in &contract.variables {
        if let Some(value) = theme.variables.get(&variable.id)
            && let Ok(css) = css_value(&variable.variable_type, value)
        {
            resolved.variables.insert(variable.id.clone(), css);
        }
    }
    for (slot, path) in &theme.assets {
        if selected.missing_files.contains(path) {
            continue;
        }
        if let Some(rel) = normalize(path) {
            resolved
                .assets
                .insert(slot.clone(), Some(format!("{theme_base_url}{rel}")));
        }
    }
    resolved.stylesheet_url = theme
        .stylesheet
        .as_deref()
        .and_then(normalize)
        .map(|rel| format!("{theme_base_url}{rel}"));
    resolved.id = Some(selected.canonical_id);
    Some(resolved)
}

/// One installed module, as theme listing and resolution need it.
pub struct InstalledModule {
    pub module_id: String,
    pub version: String,
    /// The version-scoped storage directory: the last segment of the
    /// composite module key.
    pub version_dir: String,
    pub manifest: ModuleManifest,
}

impl InstalledModule {
    /// Build from a db-proxy module row, or `None` for a row whose stored
    /// manifest is absent or no longer parses: such a module can neither
    /// provide a theme nor declare `requires`.
    pub fn from_record(record: ModuleRecord) -> Option<Self> {
        let manifest: ModuleManifest =
            serde_json::from_str(record.manifest_json.as_deref()?).ok()?;
        let module_id = if record.module_id.is_empty() {
            record
                .module_key
                .split(':')
                .next()
                .unwrap_or_default()
                .to_string()
        } else {
            record.module_id
        };
        let version_dir = record
            .module_key
            .rsplit(':')
            .next()
            .unwrap_or_default()
            .to_string();
        if module_id.is_empty() || version_dir.is_empty() {
            return None;
        }
        Some(Self {
            module_id,
            version: record.version,
            version_dir,
            manifest,
        })
    }
}

/// A theme the picker can offer for a widget.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeListing {
    pub id: String,
    pub name: String,
    pub description: String,
    pub module_id: String,
    pub module_version: String,
    pub contract_version: u32,
    /// False when the theme no longer fits the widget's current contract.
    /// Selecting it renders the defaults.
    pub compatible: bool,
    pub preview_url: Option<String>,
}

/// Every installed theme whose `target` is `widget_canonical_id`, ordered by
/// name. `public_url` is the engine's public base URL, without a trailing
/// `/`.
pub fn list_for_widget(
    installed: &[InstalledModule],
    widget_canonical_id: &str,
    public_url: &str,
) -> Vec<ThemeListing> {
    let contract = parse_widget_target(widget_canonical_id)
        .ok()
        .and_then(|(module_id, widget_id)| {
            installed
                .iter()
                .find(|m| m.module_id == module_id)
                .and_then(|m| find_target_widget(&m.manifest, widget_id))
        })
        .and_then(|w| w.theme.as_ref());

    let mut listings: Vec<ThemeListing> = Vec::new();
    for module in installed {
        for theme in module
            .manifest
            .themes
            .iter()
            .filter(|t| t.target == widget_canonical_id)
        {
            let base = theme_base_url(public_url, module, theme);
            listings.push(ThemeListing {
                id: format!("{}:theme:{}", module.module_id, theme.id),
                name: theme.name.clone(),
                description: theme.description.clone().unwrap_or_default(),
                module_id: module.module_id.clone(),
                module_version: module.version.clone(),
                contract_version: theme.contract_version,
                compatible: contract.is_some_and(|c| check_against_contract(theme, c).is_ok()),
                preview_url: theme
                    .preview
                    .as_deref()
                    .and_then(normalize)
                    .map(|rel| format!("{base}{rel}")),
            });
        }
    }
    listings.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
    listings
}

/// The public URL of a theme's file directory, ending in `/`. Must match the
/// key layout of `ManifestTheme::repository_key`.
pub fn theme_base_url(public_url: &str, module: &InstalledModule, theme: &ManifestTheme) -> String {
    format!(
        "{}/assets/modules/{}/{}/themes/{}/",
        public_url.trim_end_matches('/'),
        module.module_id,
        module.version_dir,
        theme.id
    )
}

/// Installed modules whose `requires` names `module_id`, as `(id, range)`.
pub fn dependents_of(installed: &[InstalledModule], module_id: &str) -> Vec<(String, String)> {
    installed
        .iter()
        .filter(|m| m.module_id != module_id)
        .filter_map(|m| {
            m.manifest
                .requires
                .get(module_id)
                .map(|range| (m.module_id.clone(), range.clone()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn widget(contract: serde_json::Value) -> ModuleWidget {
        serde_json::from_value(json!({
            "id": "countdown",
            "name": "Countdown",
            "entry": "widgets/countdown/index.html",
            "assets": "widgets/countdown",
            "theme": contract,
        }))
        .expect("widget parses")
    }

    fn contract() -> serde_json::Value {
        json!({
            "contractVersion": 1,
            "variables": [
                { "id": "accent", "type": "color", "default": "#7ad7ff" },
                { "id": "font", "type": "text", "default": "Inter" },
                { "id": "scale", "type": "number", "default": 1 }
            ],
            "assetSlots": [
                { "id": "background", "kinds": ["image", "video"], "default": "widgets/countdown/bg.png" },
                { "id": "endSound", "kinds": ["audio"] }
            ]
        })
    }

    fn theme(extra: serde_json::Value) -> ManifestTheme {
        let mut value = json!({
            "id": "neon",
            "name": "Neon",
            "target": "timerpro:widget:countdown",
            "contractVersion": 1,
            "variables": { "accent": "#ff2bd6", "font": "Orbitron" },
            "assets": { "background": "assets/grid.webm", "endSound": "assets/zap.mp3" },
            "stylesheet": "themes/neon.css",
            "preview": "assets/preview.png"
        });
        if let (Some(base), Some(extra)) = (value.as_object_mut(), extra.as_object()) {
            for (k, v) in extra {
                base.insert(k.clone(), v.clone());
            }
        }
        serde_json::from_value(value).expect("theme parses")
    }

    fn contract_of(w: &ModuleWidget) -> &WidgetThemeContract {
        w.theme.as_ref().expect("contract")
    }

    #[test]
    fn a_valid_contract_passes() {
        validate_contract(&widget(contract()), "widget").expect("valid");
    }

    #[test]
    fn a_contract_rejects_an_unknown_variable_type() {
        let mut c = contract();
        c["variables"][0]["type"] = json!("gradient");
        let err = validate_contract(&widget(c), "widget")
            .unwrap_err()
            .to_string();
        assert!(err.contains("unknown type \"gradient\""), "{err}");
    }

    #[test]
    fn a_contract_rejects_a_default_that_does_not_fit_its_type() {
        let mut c = contract();
        c["variables"][0]["default"] = json!("not a color!");
        let err = validate_contract(&widget(c), "widget")
            .unwrap_err()
            .to_string();
        assert!(err.contains("`default`"), "{err}");
    }

    #[test]
    fn a_slot_default_must_live_in_the_widget_assets() {
        let mut c = contract();
        c["assetSlots"][0]["default"] = json!("elsewhere/bg.png");
        let err = validate_contract(&widget(c), "widget")
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("inside the widget's `assets` directory"),
            "{err}"
        );
    }

    #[test]
    fn a_contract_reserves_the_theme_setting_id() {
        let mut w = widget(contract());
        w.settings_schema = Some(
            serde_json::from_value(json!([{ "id": "theme", "label": "Theme", "type": "text" }]))
                .expect("fields"),
        );
        let err = validate_contract(&w, "widget").unwrap_err().to_string();
        assert!(err.contains("reserved"), "{err}");
    }

    #[test]
    fn a_contract_adds_the_theme_picker_to_the_widget_settings() {
        let fields = widget(contract()).settings_fields();
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].id, "theme");
        assert_eq!(fields[0].field_type, "theme");
    }

    #[test]
    fn a_widget_without_a_contract_gets_no_theme_picker() {
        let w: ModuleWidget =
            serde_json::from_value(json!({ "id": "w", "name": "W" })).expect("widget");
        assert!(w.settings_fields().is_empty());
    }

    #[test]
    fn css_values_cannot_break_out_of_the_declaration() {
        for bad in [
            "red; background: blue",
            "red}body{",
            "</style>",
            "\"unbalanced",
            "a\\62 c",
            "url(https://example.com/x.png)",
            "line\nbreak",
        ] {
            assert!(
                css_value("text", &json!(bad)).is_err(),
                "{bad:?} should fail"
            );
        }
        assert_eq!(
            css_value("text", &json!("\"Inter\", sans-serif")).unwrap(),
            "\"Inter\", sans-serif"
        );
        assert_eq!(css_value("number", &json!(2)).unwrap(), "2");
        assert_eq!(css_value("number", &json!(0.5)).unwrap(), "0.5");
    }

    #[test]
    fn colors_are_checked_as_colors() {
        for good in [
            "#fff",
            "#ff2bd6",
            "#ff2bd680",
            "rgba(0, 0, 0, 0.7)",
            "hsl(200 50% 50%)",
            "transparent",
        ] {
            assert!(
                css_value("color", &json!(good)).is_ok(),
                "{good:?} should pass"
            );
        }
        for bad in ["#ff", "rgb(0,0,0", "12px", "calc(1px)"] {
            assert!(
                css_value("color", &json!(bad)).is_err(),
                "{bad:?} should fail"
            );
        }
    }

    #[test]
    fn a_theme_must_target_a_widget() {
        let err = validate_theme_shape(
            &theme(json!({ "target": "timerpro:action:start" })),
            "theme",
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("must name a widget"), "{err}");
    }

    #[test]
    fn a_theme_file_must_stay_inside_the_module() {
        let err = validate_theme_shape(&theme(json!({ "stylesheet": "../escape.css" })), "theme")
            .unwrap_err()
            .to_string();
        assert!(err.contains("without `..`"), "{err}");
    }

    #[test]
    fn a_theme_stylesheet_must_be_css() {
        let err = validate_theme_shape(&theme(json!({ "stylesheet": "themes/neon.js" })), "theme")
            .unwrap_err()
            .to_string();
        assert!(err.contains(".css"), "{err}");
    }

    #[test]
    fn a_theme_entry_rejects_anything_but_data_fields() {
        let err = serde_json::from_value::<ManifestTheme>(json!({
            "id": "neon", "name": "Neon", "target": "a:widget:b", "contractVersion": 1,
            "script": "themes/neon.js"
        }))
        .unwrap_err()
        .to_string();
        assert!(err.contains("unknown field `script`"), "{err}");
    }

    #[test]
    fn a_theme_fits_its_contract() {
        let w = widget(contract());
        check_against_contract(&theme(json!({})), contract_of(&w)).expect("fits");
    }

    #[test]
    fn a_theme_for_another_contract_version_does_not_fit() {
        let w = widget(contract());
        let err = check_against_contract(&theme(json!({ "contractVersion": 2 })), contract_of(&w))
            .unwrap_err()
            .to_string();
        assert!(err.contains("does not match"), "{err}");
    }

    #[test]
    fn a_theme_may_not_set_an_undeclared_variable() {
        let w = widget(contract());
        let err = check_against_contract(
            &theme(json!({ "variables": { "glow": "#fff" } })),
            contract_of(&w),
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("`variables.glow`"), "{err}");
    }

    #[test]
    fn a_theme_may_not_fill_an_undeclared_slot() {
        let w = widget(contract());
        let err = check_against_contract(
            &theme(json!({ "assets": { "logo": "assets/logo.png" } })),
            contract_of(&w),
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("`assets.logo`"), "{err}");
    }

    #[test]
    fn a_theme_value_must_fit_the_variable_type() {
        let w = widget(contract());
        let err = check_against_contract(
            &theme(json!({ "variables": { "scale": "big" } })),
            contract_of(&w),
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("`variables.scale`"), "{err}");
    }

    #[test]
    fn a_theme_asset_must_match_the_slot_kinds() {
        let w = widget(contract());
        let err = check_against_contract(
            &theme(json!({ "assets": { "endSound": "assets/zap.png" } })),
            contract_of(&w),
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("image file; this slot takes audio"), "{err}");
    }

    #[test]
    fn requires_must_be_semver_ranges() {
        let mut requires = BTreeMap::new();
        requires.insert("timerpro".to_string(), "not-a-range".to_string());
        let err = validate_requires_shape(&requires, "neonpack")
            .unwrap_err()
            .to_string();
        assert!(err.contains("not a semver range"), "{err}");
    }

    #[test]
    fn requires_is_checked_against_installed_versions() {
        let mut requires = BTreeMap::new();
        requires.insert("timerpro".to_string(), "^1.2.0".to_string());
        let mut installed = HashMap::new();
        let err = check_requires(&requires, &installed)
            .unwrap_err()
            .to_string();
        assert!(err.contains("timerpro ^1.2.0 is not installed"), "{err}");

        installed.insert("timerpro".to_string(), "1.1.0".to_string());
        let err = check_requires(&requires, &installed)
            .unwrap_err()
            .to_string();
        assert!(err.contains("1.1.0 is installed"), "{err}");

        installed.insert("timerpro".to_string(), "1.4.2".to_string());
        check_requires(&requires, &installed).expect("satisfied");
    }

    const BASE: &str = "https://engine/assets/modules/timerpro/abc1234/widgets/countdown/";
    const THEME_BASE: &str = "https://engine/assets/modules/neonpack/def5678/themes/neon/";

    fn selected(t: &ManifestTheme) -> SelectedTheme<'_> {
        SelectedTheme {
            canonical_id: "neonpack:theme:neon".to_string(),
            found: Some((t, THEME_BASE.to_string())),
            missing_files: HashSet::new(),
        }
    }

    #[test]
    fn a_widget_without_a_contract_resolves_no_theme() {
        let w: ModuleWidget =
            serde_json::from_value(json!({ "id": "w", "name": "W" })).expect("widget");
        assert_eq!(resolve(&w, "a:widget:w", BASE, None), None);
    }

    #[test]
    fn no_selection_resolves_to_the_contract_defaults() {
        let w = widget(contract());
        let r = resolve(&w, "timerpro:widget:countdown", BASE, None).expect("resolved");
        assert_eq!(r.id, None);
        assert_eq!(r.fallback, None);
        assert_eq!(r.variables["accent"], "#7ad7ff");
        assert_eq!(r.variables["scale"], "1");
        assert_eq!(
            r.assets["background"].as_deref(),
            Some(&format!("{BASE}bg.png")[..])
        );
        assert_eq!(r.assets["endSound"], None);
        assert_eq!(r.stylesheet_url, None);
    }

    #[test]
    fn a_selected_theme_overrides_the_defaults() {
        let w = widget(contract());
        let t = theme(json!({}));
        let r =
            resolve(&w, "timerpro:widget:countdown", BASE, Some(selected(&t))).expect("resolved");
        assert_eq!(r.id.as_deref(), Some("neonpack:theme:neon"));
        assert_eq!(r.fallback, None);
        assert_eq!(r.variables["accent"], "#ff2bd6");
        assert_eq!(
            r.variables["scale"], "1",
            "unset variables keep their default"
        );
        assert_eq!(
            r.assets["background"].as_deref(),
            Some(&format!("{THEME_BASE}assets/grid.webm")[..])
        );
        assert_eq!(
            r.stylesheet_url.as_deref(),
            Some(&format!("{THEME_BASE}themes/neon.css")[..])
        );
    }

    #[test]
    fn a_missing_theme_falls_back_to_the_defaults() {
        let w = widget(contract());
        let r = resolve(
            &w,
            "timerpro:widget:countdown",
            BASE,
            Some(SelectedTheme {
                canonical_id: "gone:theme:neon".to_string(),
                found: None,
                missing_files: HashSet::new(),
            }),
        )
        .expect("resolved");
        assert_eq!(r.id, None);
        assert_eq!(r.fallback, Some(ThemeFallback::Missing));
        assert_eq!(r.variables["accent"], "#7ad7ff");
    }

    #[test]
    fn a_contract_mismatch_falls_back_to_the_defaults() {
        let w = widget(contract());
        let t = theme(json!({ "contractVersion": 2 }));
        let r =
            resolve(&w, "timerpro:widget:countdown", BASE, Some(selected(&t))).expect("resolved");
        assert_eq!(r.id, None);
        assert_eq!(r.fallback, Some(ThemeFallback::Incompatible));
        assert_eq!(r.variables["accent"], "#7ad7ff");
        assert_eq!(r.stylesheet_url, None);
    }

    #[test]
    fn a_theme_for_another_widget_falls_back_to_the_defaults() {
        let w = widget(contract());
        let t = theme(json!({ "target": "timerpro:widget:other" }));
        let r =
            resolve(&w, "timerpro:widget:countdown", BASE, Some(selected(&t))).expect("resolved");
        assert_eq!(r.fallback, Some(ThemeFallback::Incompatible));
    }

    #[test]
    fn a_missing_theme_file_falls_back_to_the_slot_default() {
        let w = widget(contract());
        let t = theme(json!({}));
        let mut selection = selected(&t);
        selection
            .missing_files
            .insert("assets/grid.webm".to_string());
        let r = resolve(&w, "timerpro:widget:countdown", BASE, Some(selection)).expect("resolved");
        assert_eq!(r.id.as_deref(), Some("neonpack:theme:neon"));
        assert_eq!(
            r.assets["background"].as_deref(),
            Some(&format!("{BASE}bg.png")[..])
        );
        assert_eq!(
            r.assets["endSound"].as_deref(),
            Some(&format!("{THEME_BASE}assets/zap.mp3")[..])
        );
    }

    fn installed(module_id: &str, manifest: serde_json::Value) -> InstalledModule {
        InstalledModule {
            module_id: module_id.to_string(),
            version: manifest["version"].as_str().unwrap_or("1.0.0").to_string(),
            version_dir: "abc1234".to_string(),
            manifest: serde_json::from_value(manifest).expect("manifest"),
        }
    }

    #[test]
    fn listing_names_the_themes_for_one_widget() {
        let base = installed(
            "timerpro",
            json!({
                "id": "timerpro", "name": "Timer Pro", "version": "1.2.0",
                "widgets": [{
                    "id": "countdown", "name": "Countdown",
                    "entry": "widgets/countdown/index.html", "assets": "widgets/countdown",
                    "theme": contract()
                }]
            }),
        );
        let pack = installed(
            "neonpack",
            json!({
                "id": "neonpack", "name": "Neon", "version": "1.0.0",
                "requires": { "timerpro": "^1.2.0" },
                "themes": [
                    { "id": "neon", "name": "Neon", "target": "timerpro:widget:countdown",
                      "contractVersion": 1, "preview": "assets/preview.png" },
                    { "id": "old", "name": "Old", "target": "timerpro:widget:countdown",
                      "contractVersion": 0 },
                    { "id": "elsewhere", "name": "Elsewhere", "target": "other:widget:x",
                      "contractVersion": 1 }
                ]
            }),
        );
        let listings = list_for_widget(
            &[base, pack],
            "timerpro:widget:countdown",
            "https://engine/",
        );
        let ids: Vec<(&str, bool)> = listings
            .iter()
            .map(|l| (l.id.as_str(), l.compatible))
            .collect();
        assert_eq!(
            ids,
            vec![("neonpack:theme:neon", true), ("neonpack:theme:old", false)]
        );
        assert_eq!(
            listings[0].preview_url.as_deref(),
            Some("https://engine/assets/modules/neonpack/abc1234/themes/neon/assets/preview.png")
        );
    }

    #[test]
    fn dependents_are_the_modules_that_require_one() {
        let pack = installed(
            "neonpack",
            json!({ "id": "neonpack", "name": "Neon", "requires": { "timerpro": "^1.2.0" } }),
        );
        let other = installed("other", json!({ "id": "other", "name": "Other" }));
        assert_eq!(
            dependents_of(&[pack, other], "timerpro"),
            vec![("neonpack".to_string(), "^1.2.0".to_string())]
        );
    }
}
