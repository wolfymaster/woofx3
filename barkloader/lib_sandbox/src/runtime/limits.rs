//! Bounds the sandbox puts on module code, shared by every runtime adapter.

use crate::error::Error;
use std::fmt;
use std::time::Duration;

/// Deepest container nesting a converted value may have. Deep enough for any
/// real payload, and shallow enough that the recursive walkers stay far from
/// the end of a thread's stack. A cyclic value hits this bound too, so no
/// visited set is needed.
pub const DEFAULT_MAX_DEPTH: usize = 64;

/// Most values (containers and scalars alike) one conversion may produce.
pub const DEFAULT_MAX_NODES: usize = 100_000;

/// Most text (string values plus object keys, in bytes) one conversion may
/// produce. Approximate: it ignores the size of numbers and structure.
pub const DEFAULT_MAX_BYTES: usize = 4 * 1024 * 1024;

/// Heap one runtime instance may allocate, in either language.
pub const DEFAULT_MEMORY_BYTES: usize = 16 * 1024 * 1024;

/// Lua VM instructions one invocation may execute.
pub const DEFAULT_MAX_INSTRUCTIONS: u64 = 10_000_000;

/// Lua instructions between two budget checks. Each check reads the clock,
/// so this trades check cost against how far past a limit code can run.
pub const DEFAULT_HOOK_INTERVAL: u32 = 10_000;

/// Times QuickJS may call its interrupt handler in one invocation, sized to
/// about 1e7 bytecode ops to match the Lua budget. QuickJS calls the handler
/// once every 10,000 jumps and calls, so one call stands for thousands of
/// ops. Regular expression matching calls it once every 10,000 backtracking
/// steps as well. Measured in a release build:
/// `for (let i = 0; i < n; i++) { t += i; }` spends one call per 5,000
/// iterations (two jumps each), so 200 calls allow about 1e6 iterations of
/// about 10 ops, which take about 85 ms.
pub const DEFAULT_QUICKJS_MAX_INTERRUPTS: u64 = 200;

/// Invocations that may run at once across the whole engine. Each one holds
/// a thread of Tokio's blocking pool until it ends.
pub const DEFAULT_MAX_CONCURRENT_INVOCATIONS: usize = 32;

/// Highest accepted `max_concurrent_invocations`: Tokio's default blocking
/// pool size. More permits than threads would queue inside Tokio again.
pub const MAX_CONCURRENT_INVOCATIONS: usize = 512;

/// Longest an invocation waits for a free slot before it is refused as busy.
/// The invocation's own deadline cuts the wait shorter when that comes first.
pub const DEFAULT_PERMIT_WAIT: Duration = Duration::from_secs(5);

const MAX_CONCURRENT_INVOCATIONS_ENV: &str = "WOOFX3_SANDBOX_MAX_CONCURRENT_INVOCATIONS";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SandboxLimits {
    pub conversion: ConversionLimits,
    pub memory_bytes: usize,
    /// Lua only; QuickJS is bounded by `quickjs_max_interrupts`.
    pub max_instructions: u64,
    /// Lua only.
    pub hook_interval: u32,
    pub quickjs_max_interrupts: u64,
    pub max_concurrent_invocations: usize,
    pub permit_wait: Duration,
}

impl Default for SandboxLimits {
    fn default() -> Self {
        Self {
            conversion: ConversionLimits::default(),
            memory_bytes: DEFAULT_MEMORY_BYTES,
            max_instructions: DEFAULT_MAX_INSTRUCTIONS,
            hook_interval: DEFAULT_HOOK_INTERVAL,
            quickjs_max_interrupts: DEFAULT_QUICKJS_MAX_INTERRUPTS,
            max_concurrent_invocations: DEFAULT_MAX_CONCURRENT_INVOCATIONS,
            permit_wait: DEFAULT_PERMIT_WAIT,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SandboxLimitsError {
    #[error("{name} must be a whole number from 1 to {max}, not {value:?}")]
    Invalid {
        name: &'static str,
        value: String,
        max: usize,
    },

    #[error("sandbox limit {field} must be from {min} to {max}, not {value}")]
    OutOfRange {
        field: &'static str,
        value: u64,
        min: u64,
        max: u64,
    },
}

impl SandboxLimits {
    /// Checks every bound is usable: no budget is zero, and the concurrency
    /// cap fits Tokio's blocking pool. A zero `permit_wait` is allowed: it
    /// refuses at once when every slot is taken. A zero hook interval would install no
    /// Lua hook at all, so neither budget would be enforced.
    pub fn validate(&self) -> Result<(), SandboxLimitsError> {
        let checks: [(&'static str, u64, u64); 7] = [
            (
                "conversion.max_depth",
                self.conversion.max_depth as u64,
                u64::MAX,
            ),
            (
                "conversion.max_nodes",
                self.conversion.max_nodes as u64,
                u64::MAX,
            ),
            ("memory_bytes", self.memory_bytes as u64, u64::MAX),
            ("max_instructions", self.max_instructions, u64::MAX),
            (
                "hook_interval",
                u64::from(self.hook_interval),
                u64::from(u32::MAX),
            ),
            (
                "quickjs_max_interrupts",
                self.quickjs_max_interrupts,
                u64::MAX,
            ),
            (
                "max_concurrent_invocations",
                self.max_concurrent_invocations as u64,
                MAX_CONCURRENT_INVOCATIONS as u64,
            ),
        ];
        for (field, value, max) in checks {
            if !(1..=max).contains(&value) {
                return Err(SandboxLimitsError::OutOfRange {
                    field,
                    value,
                    min: 1,
                    max,
                });
            }
        }
        Ok(())
    }

    /// Reads `WOOFX3_SANDBOX_MAX_CONCURRENT_INVOCATIONS` through `lookup`. A
    /// blank value keeps the default; anything but a whole number from 1 to
    /// [`MAX_CONCURRENT_INVOCATIONS`] is an error.
    pub fn from_lookup(lookup: impl Fn(&str) -> String) -> Result<Self, SandboxLimitsError> {
        let defaults = Self::default();
        let value = lookup(MAX_CONCURRENT_INVOCATIONS_ENV);
        let value = value.trim();
        if value.is_empty() {
            return Ok(defaults);
        }
        match value.parse::<usize>() {
            Ok(parsed) if (1..=MAX_CONCURRENT_INVOCATIONS).contains(&parsed) => {
                let limits = Self {
                    max_concurrent_invocations: parsed,
                    ..defaults
                };
                limits.validate()?;
                Ok(limits)
            }
            _ => Err(SandboxLimitsError::Invalid {
                name: MAX_CONCURRENT_INVOCATIONS_ENV,
                value: value.to_string(),
                max: MAX_CONCURRENT_INVOCATIONS,
            }),
        }
    }
}

/// Why a runtime stopped module code before it returned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Trip {
    Instructions,
    Deadline,
}

impl From<Trip> for Error {
    fn from(trip: Trip) -> Self {
        match trip {
            Trip::Instructions => Error::InstructionLimitExceeded,
            Trip::Deadline => Error::DeadlineExceeded,
        }
    }
}

impl fmt::Display for Trip {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Trip::Instructions => write!(f, "instruction limit exceeded"),
            Trip::Deadline => write!(f, "invocation deadline exceeded"),
        }
    }
}

/// Bounds on one conversion of a value between a runtime and JSON, in either
/// direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConversionLimits {
    pub max_depth: usize,
    pub max_nodes: usize,
    pub max_bytes: usize,
}

impl Default for ConversionLimits {
    fn default() -> Self {
        Self {
            max_depth: DEFAULT_MAX_DEPTH,
            max_nodes: DEFAULT_MAX_NODES,
            max_bytes: DEFAULT_MAX_BYTES,
        }
    }
}

/// Which size bound a converted value exceeded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SizeLimit {
    Nodes(usize),
    Bytes(usize),
}

impl fmt::Display for SizeLimit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SizeLimit::Nodes(max) => write!(f, "more than {max} values"),
            SizeLimit::Bytes(max) => write!(f, "more than {max} bytes of text"),
        }
    }
}

/// What one conversion has spent of its [`ConversionLimits`]. A budget covers
/// a single value: create a fresh one per conversion.
pub(crate) struct Budget {
    limits: ConversionLimits,
    depth: usize,
    nodes: usize,
    bytes: usize,
}

impl Budget {
    pub(crate) fn new(limits: ConversionLimits) -> Self {
        Self {
            limits,
            depth: 0,
            nodes: 0,
            bytes: 0,
        }
    }

    /// Counts one value, container or scalar.
    pub(crate) fn charge_node(&mut self) -> Result<(), Error> {
        self.nodes += 1;
        if self.nodes > self.limits.max_nodes {
            return Err(Error::ValueTooLarge {
                limit: SizeLimit::Nodes(self.limits.max_nodes),
            });
        }
        Ok(())
    }

    /// Counts `len` bytes of string value or object key.
    pub(crate) fn charge_text(&mut self, len: usize) -> Result<(), Error> {
        self.bytes = self.bytes.saturating_add(len);
        if self.bytes > self.limits.max_bytes {
            return Err(Error::ValueTooLarge {
                limit: SizeLimit::Bytes(self.limits.max_bytes),
            });
        }
        Ok(())
    }

    /// Runs `convert` on the members of a container one level deeper. The
    /// depth is checked before `convert` runs, so a walker that recurses only
    /// through here can never go deeper than `max_depth`.
    pub(crate) fn nested<T>(
        &mut self,
        convert: impl FnOnce(&mut Self) -> Result<T, Error>,
    ) -> Result<T, Error> {
        if self.depth >= self.limits.max_depth {
            return Err(Error::ValueTooDeep {
                max_depth: self.limits.max_depth,
            });
        }
        self.depth += 1;
        let converted = convert(self);
        self.depth -= 1;
        converted
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny() -> ConversionLimits {
        ConversionLimits {
            max_depth: 2,
            max_nodes: 3,
            max_bytes: 5,
        }
    }

    fn lookup(value: &'static str) -> impl Fn(&str) -> String {
        move |name| {
            assert_eq!(name, "WOOFX3_SANDBOX_MAX_CONCURRENT_INVOCATIONS");
            value.to_string()
        }
    }

    #[test]
    fn test_sandbox_limits_from_lookup_parses_concurrency() {
        for (value, expected) in [("", 32), ("  ", 32), ("1", 1), (" 8 ", 8), ("512", 512)] {
            let limits = SandboxLimits::from_lookup(lookup(value)).expect(value);
            assert_eq!(limits.max_concurrent_invocations, expected, "{value:?}");
            assert_eq!(
                SandboxLimits {
                    max_concurrent_invocations: DEFAULT_MAX_CONCURRENT_INVOCATIONS,
                    ..limits
                },
                SandboxLimits::default()
            );
        }
    }

    #[test]
    fn test_sandbox_limits_from_lookup_refuses_bad_concurrency() {
        for value in ["0", "-1", "513", "eight", "1.5"] {
            assert!(
                matches!(
                    SandboxLimits::from_lookup(lookup(value)),
                    Err(SandboxLimitsError::Invalid { max: 512, .. })
                ),
                "{value:?}"
            );
        }
    }

    #[test]
    fn test_sandbox_limits_validate_accepts_defaults() {
        assert_eq!(SandboxLimits::default().validate(), Ok(()));
    }

    #[test]
    fn test_sandbox_limits_validate_refuses_unusable_bounds() {
        let defaults = SandboxLimits::default();
        for (field, limits) in [
            (
                "conversion.max_depth",
                SandboxLimits {
                    conversion: ConversionLimits {
                        max_depth: 0,
                        ..defaults.conversion
                    },
                    ..defaults
                },
            ),
            (
                "conversion.max_nodes",
                SandboxLimits {
                    conversion: ConversionLimits {
                        max_nodes: 0,
                        ..defaults.conversion
                    },
                    ..defaults
                },
            ),
            (
                "memory_bytes",
                SandboxLimits {
                    memory_bytes: 0,
                    ..defaults
                },
            ),
            (
                "max_instructions",
                SandboxLimits {
                    max_instructions: 0,
                    ..defaults
                },
            ),
            (
                "hook_interval",
                SandboxLimits {
                    hook_interval: 0,
                    ..defaults
                },
            ),
            (
                "quickjs_max_interrupts",
                SandboxLimits {
                    quickjs_max_interrupts: 0,
                    ..defaults
                },
            ),
            (
                "max_concurrent_invocations",
                SandboxLimits {
                    max_concurrent_invocations: 0,
                    ..defaults
                },
            ),
            (
                "max_concurrent_invocations",
                SandboxLimits {
                    max_concurrent_invocations: MAX_CONCURRENT_INVOCATIONS + 1,
                    ..defaults
                },
            ),
        ] {
            assert!(
                matches!(
                    limits.validate(),
                    Err(SandboxLimitsError::OutOfRange { field: f, .. }) if f == field
                ),
                "{field}"
            );
        }
    }

    #[test]
    fn test_budget_nested_refuses_past_max_depth() {
        let mut budget = Budget::new(tiny());
        let result = budget.nested(|b| b.nested(|b| b.nested(|_| Ok(()))));
        assert!(matches!(result, Err(Error::ValueTooDeep { max_depth: 2 })));
    }

    #[test]
    fn test_budget_nested_restores_depth_for_siblings() {
        let mut budget = Budget::new(tiny());
        for _ in 0..5 {
            budget
                .nested(|b| b.nested(|_| Ok(())))
                .expect("siblings at the same depth fit");
        }
    }

    #[test]
    fn test_budget_charge_node_refuses_past_max_nodes() {
        let mut budget = Budget::new(tiny());
        for _ in 0..3 {
            budget.charge_node().expect("within max_nodes");
        }
        assert!(matches!(
            budget.charge_node(),
            Err(Error::ValueTooLarge {
                limit: SizeLimit::Nodes(3)
            })
        ));
    }

    #[test]
    fn test_budget_charge_text_refuses_past_max_bytes() {
        let mut budget = Budget::new(tiny());
        budget.charge_text(5).expect("exactly max_bytes fits");
        assert!(matches!(
            budget.charge_text(1),
            Err(Error::ValueTooLarge {
                limit: SizeLimit::Bytes(5)
            })
        ));
    }
}
