package routes

import (
	"net/http"

	client "github.com/wolfymaster/woofx3/clients/db"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

func ModuleSettingRoutes(mux *http.ServeMux, app *types.App) {
	settingRepo := repo.NewModuleSettingRepository(app.Db)
	settingService := svc.NewModuleSettingService(settingRepo)
	handler := client.NewModuleSettingServiceServer(settingService)
	mux.Handle(handler.PathPrefix(), handler)
}
