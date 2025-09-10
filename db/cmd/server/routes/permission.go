package routes

import (
	"net/http"

	rpc "github.com/wolfymaster/woofx3/db/gen/go"
	"github.com/wolfymaster/woofx3/db/internal/database/repository"
	"github.com/wolfymaster/woofx3/db/internal/services"
	types "github.com/wolfymaster/woofx3/db/internal/types"
)

func PermissionRoutes(mux *http.ServeMux, app *types.App) {
	permissionRepository := repository.NewPermissionRepository(app.Db)
	permissionService := services.NewPermissionService(permissionRepository, app.Casbin)
	permissionHandler := rpc.NewPermissionServiceServer(permissionService)
	mux.Handle(permissionHandler.PathPrefix(), permissionHandler)
}
