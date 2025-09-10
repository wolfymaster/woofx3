package routes

import (
	"net/http"

	"github.com/twitchtv/twirp"
	middleware "github.com/wolfymaster/woofx3/db/cmd/server/middleware"
	rpc "github.com/wolfymaster/woofx3/db/gen/go"
	repo "github.com/wolfymaster/woofx3/db/internal/database/repository"
	svc "github.com/wolfymaster/woofx3/db/internal/services"
	types "github.com/wolfymaster/woofx3/db/internal/types"
)

func CommandRoutes(mux *http.ServeMux, app *types.App, casbinMiddleware *middleware.CasbinMiddleware) {
	commandRepository := repo.NewCommandRepository(app.Db)
	commandService := svc.NewCommandService(commandRepository)
	commandHandler := rpc.NewCommandServiceServer(
		commandService,
		twirp.WithServerHooks(twirp.ChainHooks(
			casbinMiddleware.Wrap(commandService),
		)),
	)
	mux.Handle(commandHandler.PathPrefix(), commandHandler)
}
