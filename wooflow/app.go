package main

import (
        "context"
        "encoding/json"
        "fmt"
        "log/slog"
        "net/http"
        "os"
        "strings"
        "time"

        "github.com/gorilla/mux"
        "github.com/nats-io/nats.go"
        "github.com/nats-io/nkeys"
        "github.com/wolfymaster/woofx3/wooflow/internal/adapters/sqlite"
        "github.com/wolfymaster/woofx3/wooflow/internal/core"
        "github.com/wolfymaster/woofx3/wooflow/internal/workflow/engine"
)

type App struct {
        Logger          *slog.Logger
        nc              *nats.Conn
        workflowEngine  engine.WorkflowEngine
        workflowService *core.WorkflowService
        eventRepo       core.EventRepository
        workflowRepo    core.WorkflowDefinitionRepository
        subscriptions   []*nats.Subscription
}

func (app *App) cleanup() {
        if app.workflowEngine != nil {
                app.workflowEngine.Stop()
        }

        if app.nc != nil {
                app.nc.Close()
        }

        for _, value := range app.subscriptions {
                value.Unsubscribe()
        }

        app.Logger.Info("server exited")
}

func (app *App) run() error {
        if err := app.setupNATSSubscription(); err != nil {
                return fmt.Errorf("failed to setup NATS subscription: %w", err)
        }

        return app.startHttpServer()
}

func (app *App) setupNATSSubscription() error {
        natsCallback := func(msg *nats.Msg) {
                app.handleNATSMessage(msg)
        }

        sub, err := app.nc.Subscribe("workflow.>", natsCallback)
        if err != nil {
                app.Logger.Error("failed to subscribe to workflow events", "error", err)
                os.Exit(1)
        }

        app.subscriptions = append(app.subscriptions, sub)

        return nil
}

func (app *App) handleNATSMessage(msg *nats.Msg) error {
        // Extract event type from subject
        eventType := strings.TrimPrefix(msg.Subject, "workflow.")

        app.Logger.Info("handling event", "eventType", eventType)

        // Parse event payload
        var event *core.Event
        if err := json.Unmarshal(msg.Data, &event); err != nil {
                app.Logger.Error("failed to parse event payload", "error", err)
                return fmt.Errorf("failed to parse event payload: %w", err)
        }

        if event.ID == "" {
                event.ID = fmt.Sprintf("%d", time.Now().UnixNano())
        }

        // Handle event
        if err := app.workflowEngine.HandleEvent(context.Background(), event); err != nil {
                app.Logger.Error("failed to handle event", "error", err, "eventType", eventType)
        }

        return nil
}

func (app *App) setupRoutes() *mux.Router {
        router := mux.NewRouter()

        router.HandleFunc("/v1/workflow-definitions", CreateWorkflowDefinition(app.workflowService, app.Logger)).Methods("POST")
        router.HandleFunc("/v1/workflow-definitions/{id}", GetWorkflowDefinition(app.workflowService)).Methods("GET")
        router.HandleFunc("/v1/workflow-definitions/{id}", UpdateWorkflowDefinition(app.workflowService)).Methods("PUT")
        router.HandleFunc("/v1/workflow-definitions/{id}", DeleteWorkflowDefinition(app.workflowService)).Methods("DELETE")
        router.HandleFunc("/v1/workflow-definitions", ListWorkflowDefinitions(app.workflowService)).Methods("GET")

        return router
}

func NewApp() (*App, error) {
        app := &App{}

        app.Logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))

        // Initialize repositories
        app.eventRepo = sqlite.NewEventRepository()
        app.workflowRepo = sqlite.NewWorkflowDefinitionRepository()

        app.Logger.Info("before nc setup")

        // Connect to NATS
        nc, err := setupNATS()
        if err != nil {
                return nil, fmt.Errorf("failed to connect to NATS: %w", err)
        }
        app.nc = nc

        app.Logger.Info("nc setup")

        // Create a temporal-compatible logger adapter
        temporalLogger := &TemporalLoggerAdapter{logger: app.Logger}

        // Initialize workflow engine (will auto-detect backend based on environment)
        workflowEngine, err := engine.FromEnv(context.Background(), app.eventRepo, app.workflowRepo, app.nc, temporalLogger)
        if err != nil {
                return nil, fmt.Errorf("failed to create workflow engine: %w", err)
        }

        app.workflowEngine = workflowEngine

        // Initialize services
        app.workflowService = core.NewWorkflowService(app.workflowRepo)

        return app, nil
}

func (app *App) startHttpServer() error {
        router := app.setupRoutes()

        port := 9000
        return http.ListenAndServe(fmt.Sprintf(":%d", port), router)
}

func setupNATS() (*nats.Conn, error) {
        // Parse NKey seed
        seed := os.Getenv("NATS_NKEY_SEED")
        kp, err := nkeys.FromSeed([]byte(seed))
        if err != nil {
                return nil, fmt.Errorf("failed to parse NKey seed: %w", err)
        }

        // Create JWT handler
        jwtHandler := func() (string, error) {
                return os.Getenv("NATS_USER_JWT"), nil
        }

        // Create signature handler
        sigHandler := func(nonce []byte) ([]byte, error) {
                return kp.Sign(nonce)
        }

        // Create NATS connection with JWT and NKey handlers
        nc, err := nats.Connect(
                os.Getenv("NATS_URL"),
                nats.UserJWT(jwtHandler, sigHandler),
        )
        if err != nil {
                return nil, fmt.Errorf("failed to connect to NATS: %w", err)
        }

        return nc, nil
}
