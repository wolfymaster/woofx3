package routes

import (
	"net/http"

	client "github.com/wolfymaster/woofx3/clients/db"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

// DatabaseRecordRoutes registers the DatabaseRecordService Twirp handler.
// Casbin is not applied, as for user page submissions: records are written by
// the engine's services and the dashboard through the proxy's auth surface.
func DatabaseRecordRoutes(mux *http.ServeMux, app *types.App) error {
	records, err := repo.NewDatabaseRecordRepository(app.Db, app.Now)
	if err != nil {
		return err
	}
	service, err := svc.NewDatabaseRecordService(
		repo.NewModuleRepository(app.Db, app.IDs, app.Now),
		repo.NewModuleResourceInstanceRepository(app.Db),
		records,
		app.EventPublisher,
		svc.DefaultDatabaseLimits(),
	)
	if err != nil {
		return err
	}
	handler := client.NewDatabaseRecordServiceServer(service)
	mux.Handle(handler.PathPrefix(), handler)
	return nil
}
