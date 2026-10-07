//! Where module code may connect through `ctx.http`.
//!
//! Module code is end-user code, so it reaches only the destinations its
//! module was granted:
//!
//! - **`net:<host>` permissions** the manifest declares, and the streamer
//!   approves at install like any other permission: `https` to that exact
//!   host on port 443.
//! - **`url` settings** the streamer fills in: the origin (scheme, host and
//!   port) of the value entered. Entering it is the consent. The sandbox adds
//!   it to the invocation's grants as an `origin:` entry (`origin_grant`),
//!   which a manifest can never declare.
//!
//! This module only decides; the host's HTTP client (barkloader
//! `services/http_client.rs`) enforces it on every request and redirect, and
//! checks the addresses a host name resolves to with `is_restricted_ip`.

use std::collections::HashSet;
use std::net::IpAddr;
use url::{Host, Url};

/// Prefix of a permission naming a host `ctx.http` may reach.
pub const NET_PERMISSION_PREFIX: &str = "net:";

/// Prefix of a grant derived from a `url` setting's value. Never declared in a
/// manifest: `is_known_permission` rejects it.
const ORIGIN_GRANT_PREFIX: &str = "origin:";

/// The host a `net:` permission names, if `permission` is one.
pub fn net_permission_host(permission: &str) -> Option<&str> {
    permission.strip_prefix(NET_PERMISSION_PREFIX)
}

/// Whether `host` may follow `net:`: a lowercase DNS name of at least two
/// labels, with no IP address, port, wildcard or trailing dot.
pub fn is_valid_net_host(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 {
        return false;
    }
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() < 2 {
        return false;
    }
    let label_ok = |label: &&str| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    };
    if !labels.iter().all(label_ok) {
        return false;
    }
    // A last label of digits only makes it an IPv4 address, not a name.
    labels
        .last()
        .is_some_and(|tld| !tld.bytes().all(|b| b.is_ascii_digit()))
}

/// The grant a `url` setting's value gives: its origin. None for a value that
/// is not an `http` or `https` URL with a host.
pub fn origin_grant(value: &str) -> Option<String> {
    let url = Url::parse(value.trim()).ok()?;
    let destination = Destination::of(&url).ok()?;
    Some(destination.origin_grant())
}

/// Whether module code may reach this IP address only on an engine that allows
/// private destinations: loopback, private, link-local (which holds cloud
/// metadata services), unspecified, and their IPv6 counterparts.
pub fn is_restricted_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                // Carrier-grade NAT, 100.64.0.0/10.
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64)
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_restricted_ip(IpAddr::V4(v4));
            }
            let first = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                // Unique local, fc00::/7.
                || (first & 0xFE00) == 0xFC00
                // Link-local, fe80::/10.
                || (first & 0xFFC0) == 0xFE80
        }
    }
}

/// Why module code may not reach `url`, or None when its grants allow it.
/// `granted` is the invocation's grant set: declared permissions plus the
/// `origin:` grants of its `url` settings.
pub fn refusal(granted: &HashSet<String>, url: &Url, allow_private: bool) -> Option<String> {
    let destination = match Destination::of(url) {
        Ok(destination) => destination,
        Err(reason) => return Some(reason),
    };
    if !allow_private
        && let Some(ip) = destination.ip
        && is_restricted_ip(ip)
    {
        return Some(format!(
            "{} is a private or local address",
            destination.host
        ));
    }
    if granted.contains(&destination.origin_grant()) {
        return None;
    }
    let declared = granted.contains(&format!("{NET_PERMISSION_PREFIX}{}", destination.host));
    if declared && destination.scheme == "https" && destination.port == 443 {
        return None;
    }
    if declared {
        return Some(format!(
            "{} is declared for https on port 443 only, not {}://…:{}",
            destination.host, destination.scheme, destination.port
        ));
    }
    Some(format!(
        "{} is not a host this module declares (\"{NET_PERMISSION_PREFIX}{}\" in its manifest's permissions) or a URL setting holds",
        destination.host, destination.host
    ))
}

struct Destination {
    scheme: String,
    host: String,
    port: u16,
    ip: Option<IpAddr>,
}

impl Destination {
    fn of(url: &Url) -> Result<Self, String> {
        let scheme = url.scheme().to_string();
        if scheme != "https" && scheme != "http" {
            return Err(format!("{scheme}: is not an http or https URL"));
        }
        let (host, ip) = match url.host() {
            Some(Host::Domain(domain)) => (domain.to_ascii_lowercase(), None),
            Some(Host::Ipv4(v4)) => (v4.to_string(), Some(IpAddr::V4(v4))),
            Some(Host::Ipv6(v6)) => (format!("[{v6}]"), Some(IpAddr::V6(v6))),
            None => return Err("the URL has no host".to_string()),
        };
        let port = url
            .port_or_known_default()
            .ok_or_else(|| format!("{scheme}: has no port"))?;
        Ok(Self {
            scheme,
            host,
            port,
            ip,
        })
    }

    fn origin_grant(&self) -> String {
        format!(
            "{ORIGIN_GRANT_PREFIX}{}://{}:{}",
            self.scheme, self.host, self.port
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grants(entries: &[&str]) -> HashSet<String> {
        entries.iter().map(|s| s.to_string()).collect()
    }

    fn refused(granted: &[&str], url: &str) -> Option<String> {
        refusal(&grants(granted), &Url::parse(url).unwrap(), false)
    }

    #[test]
    fn a_net_host_must_be_an_exact_lowercase_name() {
        for ok in [
            "api.spotify.com",
            "accounts.spotify.com",
            "a-b.example.co.uk",
            "x1.io",
        ] {
            assert!(is_valid_net_host(ok), "{ok}");
        }
        for bad in [
            "",
            "localhost",
            "API.spotify.com",
            "*.spotify.com",
            "api.spotify.com:443",
            "https://api.spotify.com",
            "api.spotify.com.",
            "-api.spotify.com",
            "127.0.0.1",
            "10.0.0.8",
            "[::1]",
            "api..spotify.com",
        ] {
            assert!(!is_valid_net_host(bad), "{bad}");
        }
    }

    #[test]
    fn a_declared_host_is_reachable_over_https_on_443_only() {
        assert_eq!(
            refused(&["net:api.spotify.com"], "https://api.spotify.com/v1/me"),
            None
        );
        assert_eq!(
            refused(&["net:api.spotify.com"], "https://API.Spotify.com/v1/me"),
            None
        );
        assert!(
            refused(&["net:api.spotify.com"], "http://api.spotify.com/v1/me")
                .unwrap()
                .contains("https on port 443 only")
        );
        assert!(refused(&["net:api.spotify.com"], "https://api.spotify.com:8443/").is_some());
    }

    #[test]
    fn an_undeclared_host_is_refused_and_named() {
        let reason = refused(&["net:api.spotify.com"], "https://evil.example.com/steal").unwrap();
        assert!(reason.contains("evil.example.com"), "{reason}");
        assert!(reason.contains("\"net:evil.example.com\""), "{reason}");
        assert!(refused(&[], "https://api.spotify.com/").is_some());
        // Declaring a host does not declare its subdomains.
        assert!(refused(&["net:spotify.com"], "https://api.spotify.com/").is_some());
    }

    #[test]
    fn a_url_setting_grants_its_exact_origin() {
        let grant = origin_grant("http://homeassistant.local:8123/api").unwrap();
        assert_eq!(grant, "origin:http://homeassistant.local:8123");
        assert_eq!(
            refused(&[&grant], "http://homeassistant.local:8123/api/states"),
            None
        );
        assert!(refused(&[&grant], "http://homeassistant.local:9000/").is_some());
        assert!(refused(&[&grant], "https://homeassistant.local:8123/").is_some());
        assert_eq!(
            origin_grant("https://discord.com/api/webhooks/1/x").unwrap(),
            "origin:https://discord.com:443"
        );
        assert_eq!(origin_grant("not a url"), None);
        assert_eq!(origin_grant("ftp://files.example.com/"), None);
    }

    #[test]
    fn a_private_address_is_refused_unless_the_engine_allows_it() {
        let grant = origin_grant("http://192.168.1.20:8123").unwrap();
        let url = Url::parse("http://192.168.1.20:8123/api").unwrap();
        assert!(
            refusal(&grants(&[&grant]), &url, false)
                .unwrap()
                .contains("private or local")
        );
        assert_eq!(refusal(&grants(&[&grant]), &url, true), None);
        assert!(
            refused(&[], "http://127.0.0.1:8080/")
                .unwrap()
                .contains("private or local")
        );
    }

    #[test]
    fn only_http_urls_are_reachable() {
        assert!(
            refused(&["net:example.com"], "file:///etc/passwd")
                .unwrap()
                .contains("not an http or https URL")
        );
        assert!(refused(&["net:example.com"], "ftp://example.com/").is_some());
    }

    #[test]
    fn restricted_addresses_cover_local_private_and_metadata_ranges() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.0.1",
            "169.254.169.254",
            "0.0.0.0",
            "100.64.0.1",
            "::1",
            "fd00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(is_restricted_ip(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "35.186.224.25", "2606:4700::6810:84e5"] {
            assert!(!is_restricted_ip(ip.parse().unwrap()), "{ip}");
        }
    }
}
