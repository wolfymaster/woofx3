package routes

import (
	"net/http"

	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/services"
	"github.com/wolfymaster/woofx3/db/app/types"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

func ClientRoutes(mux *http.ServeMux, app *types.App) {
	clientRepository := repository.NewClientRepository(app.Db)
	clientService := services.NewClientService(clientRepository)
	clientHandler := client.NewClientServiceServer(clientService)
	mux.Handle(clientHandler.PathPrefix(), clientHandler)
}
