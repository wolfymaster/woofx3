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
	"github.com/joho/godotenv"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nkeys"
	"github.com/wolfymaster/woofx3/wooflow/internal/adapters/sqlite"
	"github.com/wolfymaster/woofx3/wooflow/internal/core"
	"github.com/wolfymaster/woofx3/wooflow/internal/workflow/temporal"
)

type NATSHandler = func(msg *nats.Msg)

type App struct {
	Logger          *slog.Logger
	nc              *nats.Conn
	temporalClient  *temporal.Client
	workflowService *core.WorkflowService
	eventRepo       core.EventRepository
	workflowRepo    core.WorkflowDefinitionRepository
	subscriptions   []*nats.Subscription
}

func (app *App) cleanup() {
	if app.temporalClient != nil {
		app.temporalClient.Close()
	}

	if app.nc != nil {
		app.nc.Close()
	}

	for _, value := range app.subscriptions {
		value.Unsubscribe()
	}
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

	app.Logger.Info("handling event %s", eventType)

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
	if err := app.temporalClient.HandleEvent(context.Background(), event); err != nil {
		app.Logger.Error("failed to handle event", "error", err, "event_type", eventType)
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

func (app *App) startHttpServer() error {
	router := app.setupRoutes()

	port := 9000
	return http.ListenAndServe(fmt.Sprintf(":%d", port), router)
}

func main() {
	godotenv.Load("../.env")
	app, err := setupApp()
	if err != nil {
		fmt.Printf("failed: %w", err)
		os.Exit(1)
	}
	defer app.cleanup()

	app.Logger.Info("setup")

	// Register custom activities
	app.temporalClient.RegisterActivity("media_alert", temporal.MediaAlert)

	app.run()

	app.Logger.Info("shutting down...")
}

func setupApp() (*App, error) {
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

	// Initialize Temporal client
	temporalClient, err := temporal.NewClient(
		os.Getenv("TEMPORAL_HOST"),
		os.Getenv("TEMPORAL_NAMESPACE"),
		"workflow",
		app.eventRepo,
		app.workflowRepo,
		app.nc,
		app.Logger,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create Temporal client: %w", err)
	}

	app.temporalClient = temporalClient

	// Initialize services
	app.workflowService = core.NewWorkflowService(app.workflowRepo)

	return app, nil
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

func CreateWorkflowDefinition(service *core.WorkflowService, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var def core.WorkflowDefinition
		if err := json.NewDecoder(r.Body).Decode(&def); err != nil {
			logger.Error("Invalid request body", "error", err)
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if err := service.CreateWorkflowDefinition(r.Context(), &def); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(def)
	}
}

func GetWorkflowDefinition(service *core.WorkflowService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		id := vars["id"]

		def, err := service.GetWorkflowDefinition(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(def)
	}
}

func UpdateWorkflowDefinition(service *core.WorkflowService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		id := vars["id"]

		var def core.WorkflowDefinition
		if err := json.NewDecoder(r.Body).Decode(&def); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		def.ID = id
		if err := service.UpdateWorkflowDefinition(r.Context(), &def); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(def)
	}
}

func DeleteWorkflowDefinition(service *core.WorkflowService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		id := vars["id"]

		if err := service.DeleteWorkflowDefinition(r.Context(), id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

func ListWorkflowDefinitions(service *core.WorkflowService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		search := r.URL.Query().Get("search")
		filter := &core.WorkflowDefinitionFilter{
			Name: search,
		}

		defs, err := service.ListWorkflowDefinitions(r.Context(), filter)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(defs)
	}
}
