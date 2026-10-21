// Package config finds and reads an engine's configuration: the .woofx3.json (or .woofx3.config)
// file, the .env beside it and the process environment, merged into one map keyed as WOOFX3_*
// variables.
//
// It has no dependencies outside the standard library so that every Go program in the engine can
// share it, including the NATS server, which cannot depend on the runtime module because that
// pulls in the service clients.
package config
