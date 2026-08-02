package main

import (
	"github.com/wolfymaster/woofx3/clients/nats"
)

type WorkflowEnvConfig struct {
	BarkloaderWsURL  string `env:"WOOFX3_BARKLOADER_WS_URL,required"`
	BarkloaderKey    string `env:"WOOFX3_BARKLOADER_KEY"`
	DatabaseProxyURL string `env:"WOOFX3_DATABASE_PROXY_URL,required"`
	// OverlayPublicURL is the api gateway's public address (same env var
	// name api/src/config.ts and streamware/src/config.ts already use for
	// the identical concept). Used as the default `overlay.publicUrl`
	// fallback when no engine setting has been configured — asset bytes
	// route through the api gateway's public surface, not this service's
	// own internal address. Optional, with no further hardcoded fallback:
	// an empty value here resolves `${woofx3_asset_url:...}` tokens to a
	// host-less relative path rather than a guessed address.
	OverlayPublicURL string `env:"WOOFX3_OVERLAY_PUBLIC_URL"`
	nats.Config
}
