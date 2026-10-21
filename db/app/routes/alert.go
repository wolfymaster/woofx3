package routes

import (
	"net/http"
	"time"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	middleware "github.com/wolfymaster/woofx3/db/app/middleware"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
	"github.com/wolfymaster/woofx3/db/app/workers"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

// AlertRoutes registers the AlertService Twirp handler. Symmetric
// with `SceneRoutes` / `WorkflowRoutes`. Casbin middleware is
// intentionally not applied yet — the alert log is gated by the
// proxy's existing auth surface.
func AlertRoutes(mux *http.ServeMux, app *types.App, _ *middleware.CasbinMiddleware) {
	alertRepository := repo.NewAlertRepository(app.Db)
	alertService := svc.NewAlertService(alertRepository, app.EventPublisher, svc.AlertRetention{
		Period: workers.LoadConfig().EventDetailRetention,
		Now:    time.Now,
	})
	alertHandler := client.NewAlertServiceServer(
		alertService,
		twirp.WithServerHooks(twirp.ChainHooks(
		// TODO: per-alert casbin policies if/when needed.
		)),
	)
	mux.Handle(alertHandler.PathPrefix(), alertHandler)
}
