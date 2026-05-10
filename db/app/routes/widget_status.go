package routes

import (
	"net/http"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	middleware "github.com/wolfymaster/woofx3/db/app/middleware"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

// WidgetStatusRoutes registers the WidgetStatusService Twirp handler.
// Symmetric with `AlertRoutes` / `SceneRoutes`. Casbin middleware is
// not applied yet — like the alert log this is application-scoped and
// gated by the proxy's existing auth surface.
func WidgetStatusRoutes(mux *http.ServeMux, app *types.App, _ *middleware.CasbinMiddleware) {
	r := repo.NewWidgetStatusRepository(app.Db)
	s := svc.NewWidgetStatusService(r, app.EventPublisher)
	handler := client.NewWidgetStatusServiceServer(
		s,
		twirp.WithServerHooks(twirp.ChainHooks()),
	)
	mux.Handle(handler.PathPrefix(), handler)
}
