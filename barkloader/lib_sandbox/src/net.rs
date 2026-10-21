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
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
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

/// IPv4 ranges module code may reach only on an engine that allows private
/// destinations: the IANA special-purpose ranges that are not globally
/// routable, plus multicast and reserved space. `(network, prefix length)`.
const RESTRICTED_V4: &[(Ipv4Addr, u8)] = &[
    // "This network"; 0.x.x.x reaches the local host on Linux.
    (Ipv4Addr::new(0, 0, 0, 0), 8),
    (Ipv4Addr::new(10, 0, 0, 0), 8),
    // Carrier-grade NAT.
    (Ipv4Addr::new(100, 64, 0, 0), 10),
    (Ipv4Addr::new(127, 0, 0, 0), 8),
    // Link-local, which holds cloud metadata services.
    (Ipv4Addr::new(169, 254, 0, 0), 16),
    (Ipv4Addr::new(172, 16, 0, 0), 12),
    // IETF protocol assignments.
    (Ipv4Addr::new(192, 0, 0, 0), 24),
    (Ipv4Addr::new(192, 168, 0, 0), 16),
    // Benchmarking.
    (Ipv4Addr::new(198, 18, 0, 0), 15),
    // Multicast.
    (Ipv4Addr::new(224, 0, 0, 0), 4),
    // Reserved.
    (Ipv4Addr::new(240, 0, 0, 0), 4),
    (Ipv4Addr::new(255, 255, 255, 255), 32),
];

/// IPv6 ranges refused outright. `(network, prefix length)`.
const RESTRICTED_V6: &[(Ipv6Addr, u8)] = &[
    (Ipv6Addr::UNSPECIFIED, 128),
    (Ipv6Addr::LOCALHOST, 128),
    // Unique local.
    (Ipv6Addr::new(0xfc00, 0, 0, 0, 0, 0, 0, 0), 7),
    // Link-local.
    (Ipv6Addr::new(0xfe80, 0, 0, 0, 0, 0, 0, 0), 10),
    // Multicast.
    (Ipv6Addr::new(0xff00, 0, 0, 0, 0, 0, 0, 0), 8),
];

/// IPv6 ranges that carry an IPv4 address, which decides for them:
/// `(network, prefix length, bit offset of the IPv4 address from the right)`.
const EMBEDDED_V4: &[(Ipv6Addr, u8, u32)] = &[
    // IPv4-compatible, ::/96 (deprecated, still routed by some stacks).
    (Ipv6Addr::UNSPECIFIED, 96, 0),
    // IPv4-mapped, ::ffff:0:0/96.
    (Ipv6Addr::new(0, 0, 0, 0, 0, 0xffff, 0, 0), 96, 0),
    // NAT64, 64:ff9b::/96.
    (Ipv6Addr::new(0x64, 0xff9b, 0, 0, 0, 0, 0, 0), 96, 0),
    // 6to4, 2002::/16: the IPv4 address follows the prefix.
    (Ipv6Addr::new(0x2002, 0, 0, 0, 0, 0, 0, 0), 16, 80),
];

/// Whether module code may reach this IP address only on an engine that allows
/// private destinations (see `RESTRICTED_V4`, `RESTRICTED_V6` and
/// `EMBEDDED_V4`). An IPv6 address carrying an IPv4 one is restricted when
/// that IPv4 address is.
pub fn is_restricted_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let bits = u32::from(v4);
            RESTRICTED_V4
                .iter()
                .any(|&(network, prefix)| in_prefix_v4(bits, u32::from(network), prefix))
        }
        IpAddr::V6(v6) => {
            let bits = u128::from(v6);
            if RESTRICTED_V6
                .iter()
                .any(|&(network, prefix)| in_prefix_v6(bits, u128::from(network), prefix))
            {
                return true;
            }
            EMBEDDED_V4
                .iter()
                .find(|&&(network, prefix, _)| in_prefix_v6(bits, u128::from(network), prefix))
                .is_some_and(|&(_, _, offset)| {
                    // Truncating keeps exactly the 32 bits at `offset`.
                    let v4 = Ipv4Addr::from((bits >> offset) as u32);
                    is_restricted_ip(IpAddr::V4(v4))
                })
        }
    }
}

/// Whether `bits` lies in `network`/`prefix`. A prefix of 0 matches all.
fn in_prefix_v4(bits: u32, network: u32, prefix: u8) -> bool {
    let mask = u32::MAX.checked_shl(32 - u32::from(prefix)).unwrap_or(0);
    bits & mask == network & mask
}

/// Whether `bits` lies in `network`/`prefix`. A prefix of 0 matches all.
fn in_prefix_v6(bits: u128, network: u128, prefix: u8) -> bool {
    let mask = u128::MAX.checked_shl(128 - u32::from(prefix)).unwrap_or(0);
    bits & mask == network & mask
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
    fn restricted_addresses_cover_every_special_purpose_range() {
        let cases: &[(&str, bool)] = &[
            // One address per IPv4 range, and its nearest public neighbour.
            ("0.1.2.3", true),
            ("1.0.0.1", false),
            ("10.1.2.3", true),
            ("11.0.0.1", false),
            ("100.64.0.1", true),
            ("100.127.255.254", true),
            ("100.128.0.1", false),
            ("127.0.0.1", true),
            ("127.255.255.254", true),
            ("169.254.169.254", true),
            ("169.255.0.1", false),
            ("172.16.0.1", true),
            ("172.31.255.254", true),
            ("172.32.0.1", false),
            ("192.0.0.170", true),
            ("192.0.1.1", false),
            ("192.168.0.1", true),
            ("198.18.0.1", true),
            ("198.19.255.254", true),
            ("198.20.0.1", false),
            ("224.0.0.251", true),
            ("239.255.255.250", true),
            ("240.0.0.1", true),
            ("255.255.255.255", true),
            ("8.8.8.8", false),
            ("35.186.224.25", false),
            // IPv6 ranges.
            ("::", true),
            ("::1", true),
            ("fc00::1", true),
            ("fd00::1", true),
            ("fe80::1", true),
            ("febf::1", true),
            ("fec0::1", false),
            ("ff02::1", true),
            ("2606:4700::6810:84e5", false),
            // IPv6 carrying an IPv4 address follows that address.
            ("::ffff:127.0.0.1", true),
            ("::ffff:169.254.169.254", true),
            ("::ffff:8.8.8.8", false),
            ("::127.0.0.1", true),
            ("::10.0.0.1", true),
            ("::8.8.8.8", false),
            ("64:ff9b::127.0.0.1", true),
            ("64:ff9b::a9fe:a9fe", true),
            ("64:ff9b::8.8.8.8", false),
            ("2002:7f00:1::", true),
            ("2002:a9fe:a9fe::1", true),
            ("2002:c0a8:101::", true),
            ("2002:808:808::", false),
        ];
        for &(ip, restricted) in cases {
            assert_eq!(is_restricted_ip(ip.parse().unwrap()), restricted, "{ip}");
        }
    }
}
