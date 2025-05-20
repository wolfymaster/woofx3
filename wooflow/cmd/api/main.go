package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"

	"github.com/gorilla/mux"
	"github.com/spf13/viper"

	"github.com/wolfymaster/woofx3/workflow/internal/adapters/sqlite"
	"github.com/wolfymaster/woofx3/workflow/internal/core"
)

func main() {
	// Load configuration
	viper.SetConfigFile("config.yaml")
	if err := viper.ReadInConfig(); err != nil {
		slog.Error("failed to read config", "error", err)
		os.Exit(1)
	}

	// Setup logger
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	// Initialize SQLite repository
	workflowRepo := sqlite.NewWorkflowDefinitionRepository()

	// Initialize services
	workflowService := core.NewWorkflowService(workflowRepo)

	// Create router
	router := mux.NewRouter()

	// Register routes
	router.HandleFunc("/v1/workflow-definitions", createWorkflowDefinition(workflowService, logger)).Methods("POST")
	router.HandleFunc("/v1/workflow-definitions/{id}", getWorkflowDefinition(workflowService)).Methods("GET")
	router.HandleFunc("/v1/workflow-definitions/{id}", updateWorkflowDefinition(workflowService)).Methods("PUT")
	router.HandleFunc("/v1/workflow-definitions/{id}", deleteWorkflowDefinition(workflowService)).Methods("DELETE")
	router.HandleFunc("/v1/workflow-definitions", listWorkflowDefinitions(workflowService)).Methods("GET")

	// Start HTTP server
	port := viper.GetInt("server.port")
	logger.Info("starting REST server", "port", port)
	if err := http.ListenAndServe(fmt.Sprintf(":%d", port), router); err != nil {
		logger.Error("failed to serve REST", "error", err)
		os.Exit(1)
	}
}

func createWorkflowDefinition(service *core.WorkflowService, logger *slog.Logger) http.HandlerFunc {
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

func getWorkflowDefinition(service *core.WorkflowService) http.HandlerFunc {
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

func updateWorkflowDefinition(service *core.WorkflowService) http.HandlerFunc {
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

func deleteWorkflowDefinition(service *core.WorkflowService) http.HandlerFunc {
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

func listWorkflowDefinitions(service *core.WorkflowService) http.HandlerFunc {
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
