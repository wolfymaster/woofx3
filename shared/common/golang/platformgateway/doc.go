// Package platformgateway is the Go side of the platform gateway's wire
// contract: the subjects it answers on, the action catalog with each action's
// payload, and the request, outcome and reply shapes with their validators.
//
// catalog_gen.go is generated from
// shared/common/contracts/platform-gateway.json by
// shared/common/contracts/gen; run scripts/gen-contracts.sh after editing the
// contract. The TypeScript side is @woofx3/api/platform-gateway, generated
// from the same file, and both validators are tested against the shared
// fixtures in shared/common/contracts/testdata/platform-gateway.
// See docs/services/platform-gateway.md.
package platformgateway
