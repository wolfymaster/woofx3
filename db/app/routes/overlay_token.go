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

// OverlayTokenRoutes registers the OverlayTokenService Twirp handler.
// Symmetric with `SceneRoutes` — wires repository → service → Twirp
// server → mux. Casbin middleware is intentionally a TODO (same as
// scene) until a per-token permission policy lands; for now the path
// is gated only by the higher-level proxy auth.
func OverlayTokenRoutes(mux *http.ServeMux, app *types.App, _ *middleware.CasbinMiddleware) {
	overlayTokenRepository := repo.NewOverlayTokenRepository(app.Db)
	sceneRepository := repo.NewSceneRepository(app.Db)
	overlayTokenService := svc.NewOverlayTokenService(overlayTokenRepository, sceneRepository, app.EventPublisher)
	overlayTokenHandler := client.NewOverlayTokenServiceServer(
		overlayTokenService,
		twirp.WithServerHooks(twirp.ChainHooks(
		// TODO: per-token casbin policies
		)),
	)
	mux.Handle(overlayTokenHandler.PathPrefix(), overlayTokenHandler)
}
