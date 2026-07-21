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

func GroupRoutes(mux *http.ServeMux, app *types.App, casbinMiddleware *middleware.CasbinMiddleware) {
	groupRepository := repo.NewGroupRepository(app.Db)
	permissionRepository := repo.NewPermissionRepository(app.Db)
	groupService := svc.NewGroupService(groupRepository, permissionRepository, app.Casbin)
	groupHandler := client.NewGroupServiceServer(
		groupService,
		twirp.WithServerHooks(twirp.ChainHooks(
			casbinMiddleware.Wrap(groupService),
		)),
	)
	mux.Handle(groupHandler.PathPrefix(), casbinMiddleware.HTTPMiddleware(groupHandler))
}
