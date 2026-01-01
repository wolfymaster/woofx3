package routes

import (
	"net/http"

	rpc "github.com/wolfymaster/woofx3/db/app/server"
	"github.com/wolfymaster/woofx3/db/app/services"
	"github.com/wolfymaster/woofx3/db/app/types"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

func SettingsRoutes(mux *http.ServeMux, app *types.App) {
	settingsRepository := repository.NewSettingRepository(app.Db)
	settingService := services.NewSettingService(settingsRepository)
	settingsHandler := rpc.NewSettingServiceServer(settingService)
	mux.Handle(settingsHandler.PathPrefix(), settingsHandler)
}
