package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/joho/godotenv"
	"github.com/nats-io/nats.go"
)

type NATSHandler = func(msg *nats.Msg)

func main() {
	godotenv.Load("../.env")

	// create the config for messagebus
	busConfig := NATSConfig{
		URL:  "ws://localhost:9000/ws",
		Name: "wooflow",
	}

	repositoryConfig := RepositoryConfig{
		Type: "postgres",
	}

	app, err := Wooflow(AppConfig{
		MessageBusConfig: busConfig,
		RepositoryConfig: repositoryConfig,
	})
	if err != nil {
		fmt.Printf("Something went wrong starting application: %s \n", err)
		os.Exit(1)
	}
	defer app.Cleanup()

	// Register custom activities
	// app.temporalClient.RegisterActivity("media_alert", activities.MediaAlert)
	// app.temporalClient.RegisterActivity("update_timer", activities.UpdateTimer)

	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, syscall.SIGINT, syscall.SIGTERM)

	// // start wooflow
	go app.Run()

	<-shutdown

	gracefulShutdown(app)
}

// Handle graceful shutdown of application.
func gracefulShutdown(app *App) {
	app.Logger.Info("shutting down...")
}
