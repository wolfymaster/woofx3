package nats

import "os"

func CreateMessageBus(config Config, logger Logger) (*Client, error) {
	client := NewClient(config, logger)
	if err := client.Connect(); err != nil {
		return nil, err
	}
	return client, nil
}

func FromEnv(logger Logger) (*Client, error) {
	url := os.Getenv("NATS_URL")
	if url == "" {
		url = "nats://localhost:4222"
	}

	name := os.Getenv("NATS_CLIENT_NAME")
	if name == "" {
		name = "unnamed-client"
	}

	config := Config{
		URL:      url,
		Name:     name,
		JWT:      os.Getenv("NATS_JWT"),
		NKeySeed: os.Getenv("NATS_NKEY_SEED"),
	}

	return CreateMessageBus(config, logger)
}
