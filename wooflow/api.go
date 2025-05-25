package main

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/wolfymaster/woofx3/wooflow/internal/core"
)

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
