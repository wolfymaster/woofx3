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

func CommandRoutes(mux *http.ServeMux, app *types.App, casbinMiddleware *middleware.CasbinMiddleware) {
	commandRepository := repo.NewCommandRepository(app.Db)
	refRepository := repo.NewResourceReferenceRepository(app.Db)
	commandPermissionRepository := repo.NewCommandPermissionRepository(app.Db)
	permissionRepository := repo.NewPermissionRepository(app.Db)
	commandService := svc.NewCommandService(commandRepository, refRepository, commandPermissionRepository, permissionRepository, app.Casbin)
	commandHandler := client.NewCommandServiceServer(
		commandService,
		twirp.WithServerHooks(twirp.ChainHooks(
			casbinMiddleware.Wrap(commandService),
		)),
	)
	mux.Handle(commandHandler.PathPrefix(), casbinMiddleware.HTTPMiddleware(commandHandler))
}
