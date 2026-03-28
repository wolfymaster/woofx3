package routes

import (
	"net/http"

	client "github.com/wolfymaster/woofx3/clients/db"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

func ModuleRoutes(mux *http.ServeMux, app *types.App) {
	moduleRepository := repo.NewModuleRepository(app.Db)
	moduleService := svc.NewModuleService(moduleRepository, app.EventPublisher)
	moduleHandler := client.NewModuleServiceServer(moduleService)
	mux.Handle(moduleHandler.PathPrefix(), moduleHandler)
}
