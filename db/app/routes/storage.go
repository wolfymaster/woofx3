package routes

import (
	"net/http"

	client "github.com/wolfymaster/woofx3/clients/db"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
)

func StorageRoutes(mux *http.ServeMux, app *types.App) {
	storageService := svc.NewStorageService(app.BadgerDB)
	storageHandler := client.NewStorageServiceServer(storageService)
	mux.Handle(storageHandler.PathPrefix(), storageHandler)
}
