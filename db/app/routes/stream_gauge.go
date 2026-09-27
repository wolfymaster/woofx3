package routes

import (
	"net/http"

	client "github.com/wolfymaster/woofx3/clients/db"
	middleware "github.com/wolfymaster/woofx3/db/app/middleware"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

// StreamGaugeRoutes registers the StreamGaugeService Twirp handler. Casbin is
// not applied: samples are written by the engine, never on behalf of a user,
// and are gated by the proxy's existing auth surface like stream sessions.
func StreamGaugeRoutes(mux *http.ServeMux, app *types.App, _ *middleware.CasbinMiddleware) {
	streamGaugeService := svc.NewStreamGaugeService(
		repo.NewStreamGaugeRepository(app.Db),
		repo.NewStreamSessionRepository(app.Db),
	)
	streamGaugeHandler := client.NewStreamGaugeServiceServer(streamGaugeService)
	mux.Handle(streamGaugeHandler.PathPrefix(), streamGaugeHandler)
}
