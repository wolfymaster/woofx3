//! Reports installed modules whose version differs from the marketplace's.
//!
//! A module is installed once and then never looked at again. When the engine's
//! event vocabulary changed, the installed Twitch module kept declaring the
//! retired names, so every workflow bound to it subscribed to subjects nothing
//! published -- silently, because a NATS subject with no publisher is
//! indistinguishable from one that has not fired yet.
//!
//! This does not upgrade anything. Which version of a user's module runs is the
//! user's decision; the failure being fixed is that nobody could see the
//! decision needed making.

use std::collections::HashMap;
use std::time::Duration;

use anyhow::{anyhow, Result};
use serde::Deserialize;
use tracing::{info, warn};

/// Kept short and never retried. This runs on the startup path and is advisory,
/// so a slow or unreachable marketplace must cost a few seconds and nothing
/// else.
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize)]
struct CatalogResponse {
    #[serde(default)]
    modules: Vec<CatalogEntry>,
}

#[derive(Debug, Deserialize)]
struct CatalogEntry {
    id: String,
    #[serde(default)]
    version: String,
}

/// What the comparison found for one installed module.
#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    /// Installed version matches what the marketplace publishes.
    Current,
    /// The marketplace has no such module: a bundled module, or one installed
    /// from a zip that was never published. Not a problem, just unknowable.
    NotPublished,
    Differs { installed: String, published: String },
}

/// Compare installed modules against a catalog.
///
/// Split from the fetching so the rule is testable without a marketplace: the
/// interesting cases are all about which pairs of versions mean what.
pub fn compare(installed: &[(String, String)], catalog: &HashMap<String, String>) -> Vec<(String, Verdict)> {
    let mut out = Vec::with_capacity(installed.len());
    for (id, version) in installed {
        let verdict = match catalog.get(id) {
            None => Verdict::NotPublished,
            Some(published) if published == version => Verdict::Current,
            Some(published) => Verdict::Differs {
                installed: version.clone(),
                published: published.clone(),
            },
        };
        out.push((id.clone(), verdict));
    }
    out
}

/// Fetch the catalog and log anything that differs.
///
/// Never fails the caller. A marketplace that is down, misconfigured or slow
/// must not stop barkloader starting -- unlike the bundled-module reconciler,
/// whose failure genuinely does leave the engine unable to work.
pub async fn report(marketplace_url: &str, db_proxy_url: &str) {
    if marketplace_url.trim().is_empty() {
        // Not configured is not an error. Say nothing rather than warn on every
        // boot of a deployment that has no marketplace.
        return;
    }

    let catalog = match fetch_catalog(marketplace_url).await {
        Ok(catalog) => catalog,
        Err(e) => {
            warn!("module drift check skipped: could not read the marketplace catalog: {e:#}");
            return;
        }
    };

    let installed = match lib_module::db_proxy::list_modules(db_proxy_url, None).await {
        Ok(records) => records
            .into_iter()
            .map(|m| (m.module_id, m.version))
            .filter(|(id, _)| !id.is_empty())
            .collect::<Vec<_>>(),
        Err(e) => {
            warn!("module drift check skipped: could not list installed modules: {e:#}");
            return;
        }
    };

    let mut differing = 0;
    for (id, verdict) in compare(&installed, &catalog) {
        if let Verdict::Differs { installed, published } = verdict {
            differing += 1;
            warn!(
                module_id = %id,
                installed = %installed,
                published = %published,
                "installed module differs from the marketplace; reinstall it to pick up the published version"
            );
        }
    }
    if differing == 0 {
        info!(modules = installed.len(), "module drift check: all installed modules match the marketplace");
    }
}

async fn fetch_catalog(marketplace_url: &str) -> Result<HashMap<String, String>> {
    let url = format!("{}/modules", marketplace_url.trim_end_matches('/'));
    let client = reqwest::Client::builder().timeout(FETCH_TIMEOUT).build()?;
    let response = client.get(&url).send().await?;
    if !response.status().is_success() {
        return Err(anyhow!("{} returned {}", url, response.status()));
    }
    let parsed: CatalogResponse = response.json().await?;
    Ok(parsed
        .modules
        .into_iter()
        .filter(|m| !m.id.is_empty() && !m.version.is_empty())
        .map(|m| (m.id, m.version))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn installed(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn a_matching_version_is_current() {
        let got = compare(&installed(&[("woofx3_twitch", "0.2.0")]), &catalog(&[("woofx3_twitch", "0.2.0")]));
        assert_eq!(got[0].1, Verdict::Current);
    }

    /// The case this exists for: the module was installed before a rename and
    /// nothing has looked at it since.
    #[test]
    fn an_older_installed_version_is_reported() {
        let got = compare(&installed(&[("woofx3_twitch", "0.1.1")]), &catalog(&[("woofx3_twitch", "0.2.0")]));
        assert_eq!(
            got[0].1,
            Verdict::Differs { installed: "0.1.1".into(), published: "0.2.0".into() }
        );
    }

    /// Reported too, rather than ignored. A locally-built module ahead of the
    /// marketplace is a real thing to know about -- and while the marketplace
    /// was serving stale metadata, "installed is newer" was the shape the
    /// breakage actually took.
    #[test]
    fn a_newer_installed_version_is_also_reported() {
        let got = compare(&installed(&[("m", "2.0.0")]), &catalog(&[("m", "1.0.0")]));
        assert!(matches!(got[0].1, Verdict::Differs { .. }));
    }

    /// The bundled `woofx3` module is not published anywhere, and neither is a
    /// module installed from a local zip. Neither is drift.
    #[test]
    fn a_module_absent_from_the_catalog_is_not_drift() {
        let got = compare(&installed(&[("woofx3", "0.4.0")]), &catalog(&[("woofx3_twitch", "0.2.0")]));
        assert_eq!(got[0].1, Verdict::NotPublished);
    }

    #[test]
    fn an_empty_catalog_reports_nothing_as_drifted() {
        let got = compare(&installed(&[("a", "1.0.0"), ("b", "2.0.0")]), &catalog(&[]));
        assert!(got.iter().all(|(_, v)| *v == Verdict::NotPublished));
    }

    #[test]
    fn every_installed_module_gets_a_verdict() {
        let got = compare(
            &installed(&[("a", "1.0.0"), ("b", "1.0.0"), ("c", "1.0.0")]),
            &catalog(&[("a", "1.0.0"), ("b", "2.0.0")]),
        );
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].1, Verdict::Current);
        assert!(matches!(got[1].1, Verdict::Differs { .. }));
        assert_eq!(got[2].1, Verdict::NotPublished);
    }
}
