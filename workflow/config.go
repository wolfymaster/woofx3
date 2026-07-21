package main

import (
	"github.com/wolfymaster/woofx3/clients/nats"
)

type WorkflowEnvConfig struct {
	BarkloaderWsURL string `env:"WOOFX3_BARKLOADER_WS_URL,required"`
	BarkloaderKey   string `env:"WOOFX3_BARKLOADER_KEY"`
	// BarkloaderURL is barkloader's HTTP base (assets are served from
	// {BarkloaderURL}/assets — see barkloader/app/src/routes/assets.rs).
	// Used as the default `${woofx3_asset_url}` value when no
	// `assets.baseUrl` engine setting has been configured. Optional: an
	// empty value just leaves the expression unresolved to "".
	BarkloaderURL    string `env:"WOOFX3_BARKLOADER_URL"`
	DatabaseProxyURL string `env:"WOOFX3_DATABASE_PROXY_URL,required"`
	nats.Config
}
