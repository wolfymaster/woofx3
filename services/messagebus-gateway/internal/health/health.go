package health

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

// HealthChecker provides health and readiness endpoints
type HealthChecker struct {
	gateway HealthCheckable
	logger  *slog.Logger
}

// HealthCheckable interface for components that can be health checked
type HealthCheckable interface {
	IsHealthy() bool
	GetConnectedClients() int
}

// HealthResponse represents the health check response
type HealthResponse struct {
	Status           string    `json:"status"`
	Timestamp        time.Time `json:"timestamp"`
	ConnectedClients int       `json:"connected_clients"`
	Uptime           string    `json:"uptime"`
}

var startTime = time.Now()

// New creates a new HealthChecker
func New(gateway HealthCheckable, logger *slog.Logger) *HealthChecker {
	return &HealthChecker{
		gateway: gateway,
		logger:  logger,
	}
}

// Health handles the /health endpoint
func (h *HealthChecker) Health(w http.ResponseWriter, r *http.Request) {
	response := HealthResponse{
		Status:           "ok",
		Timestamp:        time.Now(),
		ConnectedClients: h.gateway.GetConnectedClients(),
		Uptime:           time.Since(startTime).String(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// Ready handles the /ready endpoint
func (h *HealthChecker) Ready(w http.ResponseWriter, r *http.Request) {
	if !h.gateway.IsHealthy() {
		response := HealthResponse{
			Status:           "not_ready",
			Timestamp:        time.Now(),
			ConnectedClients: h.gateway.GetConnectedClients(),
			Uptime:           time.Since(startTime).String(),
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(response)
		return
	}

	response := HealthResponse{
		Status:           "ready",
		Timestamp:        time.Now(),
		ConnectedClients: h.gateway.GetConnectedClients(),
		Uptime:           time.Since(startTime).String(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}