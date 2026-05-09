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

// SceneRoutes registers the SceneService Twirp handler. Symmetric
// with `WorkflowRoutes` — wires repository → service → Twirp server →
// mux. Casbin middleware is intentionally a TODO (same as workflow)
// until a per-scene permission policy lands; for now the path is
// gated only by the higher-level proxy auth.
func SceneRoutes(mux *http.ServeMux, app *types.App, _ *middleware.CasbinMiddleware) {
	sceneRepository := repo.NewSceneRepository(app.Db)
	sceneService := svc.NewSceneService(sceneRepository, app.EventPublisher)
	sceneHandler := client.NewSceneServiceServer(
		sceneService,
		twirp.WithServerHooks(twirp.ChainHooks(
		// TODO: per-scene casbin policies
		)),
	)
	mux.Handle(sceneHandler.PathPrefix(), sceneHandler)
}
