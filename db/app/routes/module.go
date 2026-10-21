package routes

import (
	"net/http"
	"time"

	client "github.com/wolfymaster/woofx3/clients/db"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
	"github.com/wolfymaster/woofx3/db/database"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

func ModuleRoutes(mux *http.ServeMux, app *types.App) {
	moduleRepository := repo.NewModuleRepository(app.Db, database.RandomIDs{}, func() time.Time { return time.Now().UTC() })
	refRepository := repo.NewResourceReferenceRepository(app.Db)
	instanceRepository := repo.NewModuleResourceInstanceRepository(app.Db)
	moduleService := svc.NewModuleService(moduleRepository, refRepository, instanceRepository, app.EventPublisher)
	moduleService.SetSegmentReconciler(svc.NewSegmentReconciler(
		repo.NewViewerFactRepository(app.Db),
		repo.NewViewerSegmentRepository(app.Db),
		moduleRepository,
	))
	moduleHandler := client.NewModuleServiceServer(moduleService)
	mux.Handle(moduleHandler.PathPrefix(), moduleHandler)
}
