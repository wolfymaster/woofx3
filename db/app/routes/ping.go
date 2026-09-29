package routes

import (
	"net/http"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	"github.com/wolfymaster/woofx3/db/app/types"
)

// PingRoutes sets up the ping/health check and migration status routes using
// Twirp. Neither requires authentication: they report liveness and readiness,
// nothing an operator owns, and db-proxy listens on loopback only.
func PingRoutes(mux *http.ServeMux, app *types.App) {
	commonService := svc.NewCommonService(app.Db)
	commonHandler := client.NewCommonServiceServer(
		commonService,
		twirp.WithServerHooks(twirp.ChainHooks(
		// No casbin middleware - ping is a public health check endpoint
		)),
	)
	mux.Handle(commonHandler.PathPrefix(), commonHandler)
}
