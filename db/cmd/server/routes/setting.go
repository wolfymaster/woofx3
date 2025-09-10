package routes

import (
	"net/http"

	rpc "github.com/wolfymaster/woofx3/db/gen/go"
	"github.com/wolfymaster/woofx3/db/internal/database/repository"
	"github.com/wolfymaster/woofx3/db/internal/services"
	"github.com/wolfymaster/woofx3/db/internal/types"
)

func SettingsRoutes(mux *http.ServeMux, app *types.App) {
	settingsRepository := repository.NewSettingRepository(app.Db)
	settingService := services.NewSettingService(settingsRepository)
	settingsHandler := rpc.NewSettingServiceServer(settingService)
	mux.Handle(settingsHandler.PathPrefix(), settingsHandler)
}
