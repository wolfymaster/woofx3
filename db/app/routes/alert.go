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

// AlertRoutes registers the AlertService Twirp handler. Symmetric
// with `SceneRoutes` / `WorkflowRoutes`. Casbin middleware is
// intentionally not applied yet — the alert log is application-
// scoped and gated by the proxy's existing auth surface.
func AlertRoutes(mux *http.ServeMux, app *types.App, _ *middleware.CasbinMiddleware) {
	alertRepository := repo.NewAlertRepository(app.Db)
	alertService := svc.NewAlertService(alertRepository, app.EventPublisher)
	alertHandler := client.NewAlertServiceServer(
		alertService,
		twirp.WithServerHooks(twirp.ChainHooks(
		// TODO: per-alert casbin policies if/when needed.
		)),
	)
	mux.Handle(alertHandler.PathPrefix(), alertHandler)
}
