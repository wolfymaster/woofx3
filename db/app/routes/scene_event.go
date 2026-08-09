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

// SceneEventRoutes registers the SceneEventService Twirp handler.
// Symmetric with `WidgetStatusRoutes` — engine-internal (sceneManager
// only), no Casbin middleware yet.
func SceneEventRoutes(mux *http.ServeMux, app *types.App, _ *middleware.CasbinMiddleware) {
	r := repo.NewSceneEventRepository(app.Db)
	s := svc.NewSceneEventService(r)
	handler := client.NewSceneEventServiceServer(
		s,
		twirp.WithServerHooks(twirp.ChainHooks()),
	)
	mux.Handle(handler.PathPrefix(), handler)
}
