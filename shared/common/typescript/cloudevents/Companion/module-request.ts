/**
 * The companion gateway's module request contract for TypeScript: what
 * barkloader's `ctx.local` sends on `engine.companion.module.request` and the
 * raw reply connectors sends back. Everything here is generated
 * (module-request.gen.ts, from shared/common/contracts/companion-gateway.json);
 * barkloader reads the same contract through its generated Rust. See
 * docs/services/companion-gateway.md.
 */
export * from "./module-request.gen";
