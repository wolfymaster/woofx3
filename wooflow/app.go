package main

import (
	"fmt"
	"log/slog"
	"os"

	"github.com/nats-io/nats.go"
	"github.com/wolfymaster/woofx3/wooflow/internal/adapters/postgres"
	"github.com/wolfymaster/woofx3/wooflow/internal/adapters/sqlite"
	"github.com/wolfymaster/woofx3/wooflow/internal/core"
	"github.com/wolfymaster/woofx3/wooflow/internal/services"
)

type MessageBusConfig struct {
	Url     string `json:"url,omitempty"`
	Options nats.Options
}

type MessageBusNatsConfig struct {
	url      string
	name     string
	jwt      string
	nKeySeed string
}

type App struct {
	EventRepository    core.EventRepository
	Logger             *slog.Logger
	MessageBus         *NATSBackend
	WorkflowRepository core.WorkflowDefinitionRepository
	WorkflowService    *services.WorkflowService
}

type RepositoryConfig struct {
	Type string
}

type AppConfig struct {
	RepositoryConfig RepositoryConfig
	MessageBusConfig NATSConfig
}

func NewMessageBusConfig(c MessageBusNatsConfig) MessageBusConfig {
	return MessageBusConfig{
		Url: c.url,
		Options: nats.Options{
			Url:  c.url,
			Name: c.name,
			Nkey: c.nKeySeed,
		},
	}
}

func Wooflow(config AppConfig) (*App, error) {
	app := &App{}

	// setup logger
	app.Logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))

	// Connect to messagebus
	bus := NewNATSBackend(config.MessageBusConfig, app.Logger)
	// if err != nil {
	// 	return nil, fmt.Errorf("unable to config message bus")
	// }
	app.MessageBus = bus

	// Initalize workflow implentation

	// create new workflow engine

	// Initialize repositories
	switch config.RepositoryConfig.Type {
	case "sqlite":
		app.EventRepository = sqlite.NewEventRepository()
		app.WorkflowRepository = sqlite.NewWorkflowDefinitionRepository()
	case "postgres":
		app.WorkflowRepository = postgres.NewWorkflowDefinitionRepository(nil) // TODO: FIX
	}

	// Initialize services
	app.WorkflowService = services.NewWorkflowService(app.WorkflowRepository)

	return app, nil
}

func (app *App) Run() {
	// TODO: implement
	fmt.Println("runnnig")
	// start webserver
}

func (app *App) Cleanup() {

}
