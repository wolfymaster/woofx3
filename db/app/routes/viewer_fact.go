package routes

import (
	"net/http"

	client "github.com/wolfymaster/woofx3/clients/db"
	middleware "github.com/wolfymaster/woofx3/db/app/middleware"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

// ViewerFactRoutes registers the ViewerFactService Twirp handler. Casbin is
// not applied: deltas are applied by the engine, never on behalf of a user,
// and definitions are gated by the proxy's existing auth surface like stream
// gauges.
func ViewerFactRoutes(mux *http.ServeMux, app *types.App, _ *middleware.CasbinMiddleware) {
	viewerFactService := svc.NewViewerFactService(
		repo.NewViewerFactRepository(app.Db),
		repo.NewModuleRepository(app.Db),
		app.EventPublisher,
	)
	viewerFactHandler := client.NewViewerFactServiceServer(viewerFactService)
	mux.Handle(viewerFactHandler.PathPrefix(), viewerFactHandler)
}
