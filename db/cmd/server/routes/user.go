package routes

import (
	"net/http"

	rpc "github.com/wolfymaster/woofx3/db/gen/go"
	"github.com/wolfymaster/woofx3/db/internal/database/repository"
	"github.com/wolfymaster/woofx3/db/internal/services"
	"github.com/wolfymaster/woofx3/db/internal/types"
)

func UserRoutes(mux *http.ServeMux, app *types.App) {
	userRepository := repository.NewUserRepository(app.Db)
	userService := services.NewUserService(userRepository)
	userHandler := rpc.NewUserServiceServer(userService)
	mux.Handle(userHandler.PathPrefix(), userHandler)
}
