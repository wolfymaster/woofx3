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

// ResourceRoutes registers the ResourceService Twirp handler — generic
// user-uploaded assets and folders. Symmetric with `SceneEventRoutes`:
// the api gateway is the only caller, and it has already authenticated
// the session, so no Casbin middleware is applied here yet.
func ResourceRoutes(mux *http.ServeMux, app *types.App, _ *middleware.CasbinMiddleware) {
	r := repo.NewResourceRepository(app.Db)
	s := svc.NewResourceService(r)
	handler := client.NewResourceServiceServer(
		s,
		twirp.WithServerHooks(twirp.ChainHooks()),
	)
	mux.Handle(handler.PathPrefix(), handler)
}
