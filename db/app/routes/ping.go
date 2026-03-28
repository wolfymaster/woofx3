package routes

import (
	"net/http"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	svc "github.com/wolfymaster/woofx3/db/app/services"
)

// PingRoutes sets up the ping/health check route using Twirp
// This route does not require authentication and is used to verify the db proxy is accessible
func PingRoutes(mux *http.ServeMux) {
	commonService := svc.NewCommonService()
	commonHandler := client.NewCommonServiceServer(
		commonService,
		twirp.WithServerHooks(twirp.ChainHooks(
		// No casbin middleware - ping is a public health check endpoint
		)),
	)
	mux.Handle(commonHandler.PathPrefix(), commonHandler)
}
