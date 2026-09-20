package routes

import (
	"net/http"

	client "github.com/wolfymaster/woofx3/clients/db"
	middleware "github.com/wolfymaster/woofx3/db/app/middleware"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

// StreamSessionRoutes registers the StreamSessionService Twirp handler.
// Symmetric with `AlertRoutes`; casbin is not applied, as stream sessions are
// application-scoped and gated by the proxy's existing auth surface.
func StreamSessionRoutes(mux *http.ServeMux, app *types.App, _ *middleware.CasbinMiddleware) {
	streamSessionRepository := repo.NewStreamSessionRepository(app.Db)
	streamSessionService := svc.NewStreamSessionService(streamSessionRepository, app.EventPublisher)
	streamSessionHandler := client.NewStreamSessionServiceServer(streamSessionService)
	mux.Handle(streamSessionHandler.PathPrefix(), streamSessionHandler)
}
