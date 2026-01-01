package routes

import (
	"net/http"

	rpc "github.com/wolfymaster/woofx3/db/app/server"
	"github.com/wolfymaster/woofx3/db/app/services"
	"github.com/wolfymaster/woofx3/db/app/types"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

func UserRoutes(mux *http.ServeMux, app *types.App) {
	userRepository := repository.NewUserRepository(app.Db)
	userService := services.NewUserService(userRepository, app.EventPublisher)
	userHandler := rpc.NewUserServiceServer(userService)
	mux.Handle(userHandler.PathPrefix(), userHandler)
}
