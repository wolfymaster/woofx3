//! Wire contracts barkloader shares with services in other languages,
//! generated from `shared/common/contracts` by `scripts/gen-contracts.sh`.
//!
//! The generated files are pulled in with `include!` so that rustfmt and
//! format checks never touch them; the generator already writes them in
//! rustfmt's layout.

/// The companion gateway's module request contract: what `ctx.local` sends
/// on `engine.companion.module.request` and the raw reply connectors sends
/// back. Shared with connectors through
/// `shared/common/typescript/cloudevents/Companion/module-request.gen.ts`.
pub mod companion_gateway {
    include!("companion_gateway.gen.rs");
}
