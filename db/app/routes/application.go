package routes

import (
	"net/http"

	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/services"
	"github.com/wolfymaster/woofx3/db/app/types"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

func ApplicationRoutes(mux *http.ServeMux, app *types.App) {
	applicationRepository := repository.NewApplicationRepository(app.Db)
	applicationService := services.NewApplicationService(applicationRepository)
	applicationHandler := client.NewApplicationServiceServer(applicationService)
	mux.Handle(applicationHandler.PathPrefix(), applicationHandler)
}
