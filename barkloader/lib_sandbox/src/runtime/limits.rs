//! Bounds the sandbox puts on module code, shared by every runtime adapter.

use crate::error::Error;
use std::fmt;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SandboxLimits {
    pub conversion: ConversionLimits,
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
