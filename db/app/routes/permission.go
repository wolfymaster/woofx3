package routes

import (
	"net/http"

	rpc "github.com/wolfymaster/woofx3/db/app/server"
	"github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

func PermissionRoutes(mux *http.ServeMux, app *types.App) {
	permissionRepository := repository.NewPermissionRepository(app.Db)
	permissionService := services.NewPermissionService(app, permissionRepository, app.Casbin)
	permissionHandler := rpc.NewPermissionServiceServer(permissionService)
	mux.Handle(permissionHandler.PathPrefix(), permissionHandler)
}
