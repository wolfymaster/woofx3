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
/// ops. Measured in a release build: `for (let i = 0; i < n; i++) { t += i; }`
/// spends one call per 5,000 iterations (two jumps each), so 200 calls allow
/// about 1e6 iterations of about 10 ops, which take about 85 ms.
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
    /// Lua only. Must be above zero.
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
}

impl SandboxLimits {
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
            Ok(parsed) if (1..=MAX_CONCURRENT_INVOCATIONS).contains(&parsed) => Ok(Self {
                max_concurrent_invocations: parsed,
                ..defaults
            }),
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
