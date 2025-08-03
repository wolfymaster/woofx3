package main

import (
	"os"
	"syscall"
	"os/signal"

	"github.com/joho/godotenv"
)

func main() {
	godotenv.Load("../.env")
	app, err := NewApp()
	if err != nil {
		os.Exit(1)
	}
	defer app.cleanup()

	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, syscall.SIGINT, syscall.SIGTERM)

	go app.run()

	<-shutdown

	app.Logger.Info("shutting down...")
}
