package routes

import (
	"net/http"

	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/services"
	"github.com/wolfymaster/woofx3/db/app/types"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

func UserRoutes(mux *http.ServeMux, app *types.App) {
	userRepository := repository.NewUserRepository(app.Db)
	userService := services.NewUserService(userRepository, app.EventPublisher)
	userHandler := client.NewUserServiceServer(userService)
	mux.Handle(userHandler.PathPrefix(), userHandler)
}
