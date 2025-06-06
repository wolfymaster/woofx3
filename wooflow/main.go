package main

import (
	"os"
	"os/signal"
	"syscall"

	"github.com/joho/godotenv"
	"github.com/nats-io/nats.go"
	"github.com/wolfymaster/woofx3/wooflow/activities"
)

type NATSHandler = func(msg *nats.Msg)

func main() {
	godotenv.Load("../.env")
	app, err := NewApp()
	if err != nil {
		os.Exit(1)
	}
	defer app.cleanup()

	// Register custom activities
	app.temporalClient.RegisterActivity("media_alert", activities.MediaAlert)
	app.temporalClient.RegisterActivity("update_timer", activities.UpdateTimer)

	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, syscall.SIGINT, syscall.SIGTERM)

	go app.run()

	<-shutdown

	app.Logger.Info("shutting down...")
}
