package routes

import (
	"fmt"
	"net/http"
	"time"

	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/services"
	"github.com/wolfymaster/woofx3/db/app/types"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

func ClientRoutes(mux *http.ServeMux, app *types.App) error {
	clientRepository := repository.NewClientRepository(app.Db)
	clientService, err := services.NewClientService(clientRepository, app.EventPublisher, func() time.Time { return time.Now().UTC() })
	if err != nil {
		return fmt.Errorf("client routes: %w", err)
	}
	clientHandler := client.NewClientServiceServer(clientService)
	mux.Handle(clientHandler.PathPrefix(), clientHandler)
	return nil
}
