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

        // Register custom activities using adapters for api compatibility
        app.workflowEngine.RegisterActivity("media_alert", activities.MediaAlertAdapter)
        app.workflowEngine.RegisterActivity("update_timer", activities.UpdateTimerAdapter)

        // Start workflow engine
        if err := app.workflowEngine.Start(context.Background()); err != nil {
                app.Logger.Error("failed to start workflow engine", "error", err)
                os.Exit(1)
        }

        shutdown := make(chan os.Signal, 1)
        signal.Notify(shutdown, syscall.SIGINT, syscall.SIGTERM)

        go app.run()

        <-shutdown

        app.Logger.Info("shutting down...")
}
