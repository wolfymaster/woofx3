package routes

import (
	"net/http"
	"time"

	client "github.com/wolfymaster/woofx3/clients/db"
	middleware "github.com/wolfymaster/woofx3/db/app/middleware"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

// LocalUISettingRoutes registers the LocalUISettingService Twirp handler.
// Casbin is not applied: its policies grant chat users access to commands,
// and these settings belong to the engine's one dashboard, which reaches them
// through the api's authenticated session, like stream gauges.
func LocalUISettingRoutes(mux *http.ServeMux, app *types.App, _ *middleware.CasbinMiddleware) {
	localUISettingService := svc.NewLocalUISettingService(repo.NewLocalUISettingRepository(app.Db), func() time.Time { return time.Now().UTC() })
	localUISettingHandler := client.NewLocalUISettingServiceServer(localUISettingService)
	mux.Handle(localUISettingHandler.PathPrefix(), localUISettingHandler)
}
