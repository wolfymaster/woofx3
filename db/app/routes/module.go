package routes

import (
	"net/http"

	client "github.com/wolfymaster/woofx3/clients/db"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

func ModuleRoutes(mux *http.ServeMux, app *types.App) error {
	moduleRepository := repo.NewModuleRepository(app.Db, app.IDs, app.Now)
	refRepository := repo.NewResourceReferenceRepository(app.Db)
	instanceRepository := repo.NewModuleResourceInstanceRepository(app.Db)
	kindValidators := svc.NewKindSettingsValidators()
	records, err := repo.NewDatabaseRecordRepository(app.Db, app.Now)
	if err != nil {
		return err
	}
	databaseColumns, err := svc.NewDatabaseColumnsValidator(records, svc.DefaultDatabaseLimits())
	if err != nil {
		return err
	}
	if err := kindValidators.Register(svc.DatabaseKind, databaseColumns); err != nil {
		return err
	}
	moduleService := svc.NewModuleService(moduleRepository, refRepository, instanceRepository, app.EventPublisher, kindValidators)
	moduleService.SetSegmentReconciler(svc.NewSegmentReconciler(
		repo.NewViewerFactRepository(app.Db),
		repo.NewViewerSegmentRepository(app.Db),
		moduleRepository,
	))
	moduleHandler := client.NewModuleServiceServer(moduleService)
	mux.Handle(moduleHandler.PathPrefix(), moduleHandler)
	return nil
}
