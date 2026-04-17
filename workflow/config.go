package main

import (
	"github.com/wolfymaster/woofx3/clients/nats"
)

type WorkflowEnvConfig struct {
	BarkloaderWsURL  string `env:"WOOFX3_BARKLOADER_WS_URL,required"`
	BarkloaderKey    string `env:"WOOFX3_BARKLOADER_KEY"`
	DatabaseProxyURL string `env:"WOOFX3_DATABASE_PROXY_URL,required"`
	nats.Config
}
